import type { Blockstore } from 'interface-blockstore'
import { BaseBlockstore } from 'blockstore-core'
import type { CID } from 'multiformats'
import type { Libp2p } from '@libp2p/interface'
import type { SimpleBitswap } from './bitswap.js'
import { multiaddr } from '@multiformats/multiaddr'
import { logger } from './logger.js'

const BITSWAP_TIMEOUT_MS = parseInt(process.env.BITSWAP_WANT_TIMEOUT_MS || '5000', 10)
const DHT_TIMEOUT_MS = parseInt(process.env.DHT_PROVIDER_TIMEOUT_MS || '5000', 10)
const IPNI_TIMEOUT_MS = parseInt(process.env.IPNI_TIMEOUT_MS || '8000', 10)

/**
 * Try to retrieve a block via bitswap within the specified timeout.
 */
async function tryBitswap(
	bitswap: SimpleBitswap,
	cid: CID,
	timeoutMs: number
): Promise<Uint8Array | null> {
	try {
		return await bitswap.want(cid, { signal: AbortSignal.timeout(timeoutMs) })
	} catch {
		return null
	}
}

/**
 * Try to retrieve a block via DHT provider lookup.
 * Finds providers from DHT, dials them, and retries bitswap with the newly dialled peers.
 */
async function tryDHTRetrieval(
	libp2p: Libp2p,
	bitswap: SimpleBitswap,
	cid: CID,
	dhtTimeoutMs: number,
	bitswapTimeoutMs: number
): Promise<Uint8Array | null> {
	try {
		const dhtSignal = AbortSignal.timeout(dhtTimeoutMs)
		for await (const provider of libp2p.contentRouting.findProviders(cid, { signal: dhtSignal })) {
			for (const addr of provider.multiaddrs) {
				try {
					await libp2p.dial(addr)
					break // Successfully dialled, move to retry
				} catch {
					// Try next address
				}
			}
			try {
				return await bitswap.want(cid, { signal: AbortSignal.timeout(bitswapTimeoutMs) })
			} catch {
				// Try next provider
			}
		}
	} catch {
		// DHT timed out or empty
	}
	return null
}

/**
 * NetworkAwareBlockstore wraps an S3 blockstore with network block retrieval via bitswap.
 *
 * Retrieval strategy (for get()):
 * 1. Try to retrieve block from local S3 blockstore
 * 2. On cache miss (GetFailedError/NoSuchKey): race bitswap broadcast vs DHT provider lookup
 * 3. On both stages timing out: IPNI provider lookup with shared abort budget
 * 4. On success: persist the fetched block to S3 for fast subsequent access
 * 5. Raise NotFoundError if not found locally and not available on network
 *
 * All other operations (put, has, delete, etc.) delegate directly to the underlying S3 blockstore.
 */
export class NetworkAwareBlockstore extends BaseBlockstore {
	constructor(
		private readonly s3Blockstore: Blockstore,
		private readonly bitswap: SimpleBitswap,
		private readonly libp2p: Libp2p,
	) {
		super()
	}

	/**
	 * Retrieve a block, with fallback to network retrieval via bitswap and DHT providers.
	 */
	async *get(cid: CID): AsyncGenerator<Uint8Array> {
		try {
			// 1. Try local S3 blockstore first
			yield* this.s3Blockstore.get(cid)
			return
		} catch (err: any) {
			// Check if this is a cache miss (S3 key doesn't exist)
			const isMiss =
				err?.name === 'GetFailedError' ||
				err?.code === 'NoSuchKey' ||
				(err?.message && err.message.includes('NoSuchKey')) ||
				err?.code === 'ERR_NOT_FOUND' ||
				err?.name === 'NotFoundError'

			if (!isMiss) {
				// Some other error occurred (permissions, network, etc.)
				throw err
			}
		}

		// Block not in local S3, try to fetch from network
		logger.debug({ cid: cid.toString() }, 'Block not in local storage, attempting network retrieval')

		// Stages 2+3: race bitswap broadcast vs DHT provider lookup
		const block = await Promise.race([
			tryBitswap(this.bitswap, cid, BITSWAP_TIMEOUT_MS),
			tryDHTRetrieval(this.libp2p, this.bitswap, cid, DHT_TIMEOUT_MS, BITSWAP_TIMEOUT_MS),
		])
		if (block !== null) {
			logger.debug({ cid: cid.toString() }, 'Block retrieved from network (bitswap/DHT)')
			try {
				await this.s3Blockstore.put(cid, block)
			} catch {
				// Non-fatal: we have the block even if caching fails
			}
			yield block
			return
		}

		// Stage 4: IPNI provider lookup with shared abort budget
		const ipniController = new AbortController()
		const ipniTimer = setTimeout(() => ipniController.abort(), IPNI_TIMEOUT_MS)
		try {
			const res = await fetch(
				`https://cid.contact/routing/v1/providers/${cid.toString()}`,
				{ signal: ipniController.signal, headers: { Accept: 'application/json' } }
			)
			if (res.ok) {
				const json = await res.json() as { Providers?: Array<{ ID: string; Addrs: string[] }> }
				for (const provider of json.Providers ?? []) {
					if (ipniController.signal.aborted) break
					for (const addr of provider.Addrs ?? []) {
						try {
							await this.libp2p.dial(multiaddr(addr))
							break
						} catch {
							// Try next address
						}
					}
					try {
						const ipniBlock = await this.bitswap.want(cid, { signal: ipniController.signal })
						logger.debug({ cid: cid.toString() }, 'Block retrieved from IPNI provider')
						try {
							await this.s3Blockstore.put(cid, ipniBlock)
						} catch {
							// Non-fatal: we have the block even if caching fails
						}
						yield ipniBlock
						return
					} catch {
						// Try next provider
					}
				}
			}
		} catch (err) {
			logger.debug({ cid: cid.toString(), error: String(err) }, 'IPNI lookup failed or timed out')
		} finally {
			clearTimeout(ipniTimer)
		}

		// Block not found on peer network, try public IPFS gateway as last resort
		logger.debug({ cid: cid.toString() }, 'Trying public IPFS gateway fallback')
		try {
			const gatewaySignal = AbortSignal.timeout(DHT_TIMEOUT_MS)
			const gatewayUrl = `https://ipfs.io/ipfs/${cid.toString()}`
			const response = await fetch(gatewayUrl, {
				signal: gatewaySignal,
				redirect: 'follow',
				headers: { Accept: 'application/vnd.ipld.raw' },
			})

			if (response.ok) {
				const data = new Uint8Array(await response.arrayBuffer())
				logger.debug({ cid: cid.toString() }, 'Block retrieved from public gateway')
				try {
					await this.s3Blockstore.put(cid, data)
				} catch (putErr) {
					logger.warn({ cid: cid.toString(), error: String(putErr) }, 'Failed to cache block from gateway')
				}
				yield data
				return
			}
		} catch (gatewayErr) {
			logger.debug(
				{ cid: cid.toString(), error: String(gatewayErr) },
				'Public gateway fallback failed'
			)
		}

		// Block not found anywhere
		throw new Error(`Block not found: ${cid.toString()}`)
	}

	/**
	 * Check if a block exists locally (no network check).
	 */
	async has(cid: CID): Promise<boolean> {
		try {
			return await this.s3Blockstore.has(cid)
		} catch {
			return false
		}
	}

	/**
	 * Store a block locally.
	 */
	async put(cid: CID, block: Uint8Array): Promise<CID> {
		await this.s3Blockstore.put(cid, block)
		return cid
	}

	/**
	 * Delete a block from local storage.
	 */
	async delete(cid: CID): Promise<void> {
		return this.s3Blockstore.delete(cid)
	}

	/**
	 * List all blocks (delegates to S3).
	 */
	async *getAll(): AsyncGenerator<any> {
		yield* this.s3Blockstore.getAll()
	}

	/**
	 * Put multiple blocks.
	 */
	async *putMany(blocks: any): AsyncGenerator<CID> {
		yield* this.s3Blockstore.putMany(blocks)
	}

	/**
	 * Delete multiple blocks.
	 */
	async *deleteMany(cids: any): AsyncGenerator<CID> {
		yield* this.s3Blockstore.deleteMany(cids)
	}
}
