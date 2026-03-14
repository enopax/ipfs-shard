import type { Blockstore, Pair, InputPair } from 'interface-blockstore'
import type { CID } from 'multiformats'
import { BaseBlockstore } from 'blockstore-core'
import { LRUCache } from 'lru-cache'

/**
 * LRU-cached wrapper around an S3 blockstore.
 * Implements write-through caching (all writes go to both cache and S3).
 * Cache-first reads (miss → fetch from S3 → cache).
 *
 * The LRU cache is size-bounded (in bytes), not count-bounded.
 */
export class LRUBlockstore extends BaseBlockstore {
	private cache: LRUCache<string, Uint8Array>
	private innerStore: Blockstore

	constructor(inner: Blockstore, maxSizeMB: number) {
		super()
		this.innerStore = inner
		this.cache = new LRUCache<string, Uint8Array>({
			maxSize: maxSizeMB * 1024 * 1024,
			sizeCalculation: (val) => val.byteLength,
		})
	}

	/**
	 * Put block: write to cache and S3 (write-through).
	 */
	async put(cid: CID, val: Uint8Array): Promise<CID> {
		const key = cid.toString()
		// Write to S3 first
		await this.innerStore.put(cid, val)
		// Then cache it
		this.cache.set(key, val)
		return cid
	}

	/**
	 * Get block: cache-first, fall through to S3.
	 */
	async *get(cid: CID): AsyncGenerator<Uint8Array> {
		const key = cid.toString()

		// Check cache first
		const cached = this.cache.get(key)
		if (cached) {
			yield cached
			return
		}

		// Cache miss: fetch from S3
		for await (const chunk of this.innerStore.get(cid)) {
			// Cache the result (for simple single-yield case)
			this.cache.set(key, chunk)
			yield chunk
		}
	}

	/**
	 * Has block: cache-first, fall through to S3.
	 */
	async has(cid: CID): Promise<boolean> {
		const key = cid.toString()

		// Check cache first
		if (this.cache.has(key)) return true

		// Fall through to S3
		return await this.innerStore.has(cid)
	}

	/**
	 * Delete block: evict from cache, delete from S3.
	 */
	async delete(cid: CID): Promise<void> {
		const key = cid.toString()
		// Evict from cache
		this.cache.delete(key)
		// Delete from S3
		await this.innerStore.delete(cid)
	}

	/**
	 * Stream blocks from inner store (bypasses cache for iteration).
	 */
	async *getMany(cids: Iterable<CID>): AsyncGenerator<Pair> {
		for await (const pair of this.innerStore.getMany(cids)) {
			yield pair
		}
	}

	/**
	 * Put multiple blocks with write-through.
	 */
	async *putMany(blocks: AsyncIterable<InputPair> | Iterable<InputPair>): AsyncGenerator<CID> {
		for await (const cid of this.innerStore.putMany(blocks)) {
			yield cid
		}
	}
}
