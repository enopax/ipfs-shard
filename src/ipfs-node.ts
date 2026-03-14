import type { Blockstore } from 'interface-blockstore'
import type { Datastore } from 'interface-datastore'
import { Key } from 'interface-datastore'
import type { Libp2p } from '@libp2p/interface'
import { NotFoundError } from '@libp2p/interface'
import { CID } from 'multiformats'
import { SimpleBitswap } from './bitswap.js'
import { logger } from './logger.js'
import { createLibp2pNode } from './libp2p-config.js'

/**
 * CRITICAL: Wrap S3Datastore.get() to convert GetFailedError: NoSuchKey to NotFoundError.
 * This is non-negotiable — libp2p's keychain expects NotFoundError, not S3's GetFailedError.
 * Without this wrapper, libp2p startup fails with: "NoSuchKey: The specified key does not exist."
 */
function wrapDatastoreWithErrorHandler(datastore: Datastore): Datastore {
	const originalGet = datastore.get.bind(datastore)
	const originalHas = datastore.has?.bind(datastore)

	// Wrap get() - converts S3 "NoSuchKey" errors to NotFoundError
	const wrappedGet = async (key: any): Promise<Uint8Array> => {
		try {
			return await originalGet(key)
		} catch (err: any) {
			// S3Datastore throws GetFailedError with code 'NoSuchKey'
			// We need to convert it to NotFoundError that libp2p expects
			if (
				err?.name === 'GetFailedError' ||
				err?.code === 'NoSuchKey' ||
				(err?.message && err.message.includes('NoSuchKey'))
			) {
				throw new NotFoundError(key)
			}
			throw err
		}
	}

	// Wrap has() - returns false instead of throwing for missing keys
	const wrappedHas = async (key: any): Promise<boolean> => {
		if (!originalHas) return false
		try {
			return await originalHas(key)
		} catch (err: any) {
			// S3 "NoSuchKey" means the key doesn't exist, so has() should return false
			if (
				err?.name === 'GetFailedError' ||
				err?.code === 'NoSuchKey' ||
				(err?.message && err.message.includes('NoSuchKey'))
			) {
				return false
			}
			throw err
		}
	}

	// Replace methods with wrapped versions
	datastore.get = wrappedGet as any
	if (originalHas) {
		datastore.has = wrappedHas as any
	}

	return datastore
}

/**
 * DHT announcement record persisted in S3 datastore.
 */
export interface DHTAnnounceRecord {
	status: 'pending' | 'success' | 'failed'
	announcedAt: number // unix milliseconds
	error?: string
}

/**
 * Custom IPFS node combining libp2p, blockstore, datastore, and pinning.
 * Replaces the Helia abstraction layer with direct access to underlying components.
 */
export class IPFSNode {
	constructor(
		public readonly libp2p: Libp2p,
		public readonly blockstore: Blockstore,
		public readonly datastore: Datastore,
		public readonly bitswap: SimpleBitswap,
	) {}

	/**
	 * Routing operations via libp2p content routing (DHT).
	 */
	routing = {
		provide: (cid: CID) => this.libp2p.contentRouting.provide(cid),
		findProviders: (cid: CID, opts?: { signal?: AbortSignal }) =>
			this.libp2p.contentRouting.findProviders(cid, opts),
	}

	/**
	 * Pinning operations stored in S3 datastore.
	 */
	pins = {
		add: (cid: CID) => this.pinAdd(cid),
		rm: (cid: CID) => this.pinRm(cid),
		ls: () => this.pinLs(),
	}

	/**
	 * DHT announcement status tracking stored in S3 datastore.
	 */
	dht = {
		getStatus: (cid: CID) => this.getDHTStatus(cid),
		setStatus: (cid: CID, record: DHTAnnounceRecord) => this.setDHTStatus(cid, record),
	}

	/**
	 * Check if a CID is pinned locally.
	 */
	async isPinned(cid: CID): Promise<boolean> {
		try {
			const keyStr = '/local/pins/' + cid.toString()
			return await this.datastore.has(keyStr as any)
		} catch {
			return false
		}
	}

	/**
	 * Add a pin to the datastore at /local/pins/{cid}.
	 */
	private async pinAdd(cid: CID): Promise<void> {
		const key = `/local/pins/${cid.toString()}`
		try {
			await this.datastore.put(key as any, new Uint8Array(0))
		} catch (err) {
			throw new Error(`Failed to pin ${cid}: ${String(err)}`)
		}
	}

	/**
	 * Remove a pin from the datastore.
	 */
	private async pinRm(cid: CID): Promise<void> {
		const key = `/local/pins/${cid.toString()}`
		try {
			await this.datastore.delete(key as any)
		} catch (err) {
			// It's ok if the pin doesn't exist
			if (err instanceof Error && err.message.includes('not found')) {
				return
			}
			throw new Error(`Failed to unpin ${cid}: ${String(err)}`)
		}
	}

	/**
	 * List all pins from the datastore.
	 */
	private async *pinLs(): AsyncIterable<{ cid: CID }> {
		try {
			const query = this.datastore.query({ prefix: '/local/pins/' })
			for await (const result of query) {
				const cidStr = result.key.toString().substring('/local/pins/'.length)
				try {
					const cid = CID.parse(cidStr)
					yield { cid }
				} catch {
					// Skip invalid CIDs
					continue
				}
			}
		} catch (err) {
			throw new Error(`Failed to list pins: ${String(err)}`)
		}
	}

	/**
	 * Get DHT announcement status for a CID from datastore.
	 * Returns null if not found.
	 */
	private async getDHTStatus(cid: CID): Promise<DHTAnnounceRecord | null> {
		try {
			const keyStr = '/local/dht-announces/' + cid.toString()
			const data = await this.datastore.get(keyStr as any)
			const json = JSON.parse(new TextDecoder().decode(data))
			return json as DHTAnnounceRecord
		} catch (err: any) {
			// Handle NotFoundError or S3 GetFailedError when key doesn't exist
			if (
				err.name === 'NotFoundError' ||
				err.code === 'ERR_NOT_FOUND' ||
				err?.name === 'GetFailedError' ||
				err?.code === 'NoSuchKey'
			) {
				return null
			}
			logger.warn({ cid: cid.toString(), error: String(err) }, 'Failed to load DHT announce status')
			return null
		}
	}

	/**
	 * Set DHT announcement status for a CID in datastore.
	 */
	private async setDHTStatus(cid: CID, record: DHTAnnounceRecord): Promise<void> {
		try {
			const keyStr = '/local/dht-announces/' + cid.toString()
			const data = new TextEncoder().encode(JSON.stringify(record))
			await this.datastore.put(keyStr as any, data)
		} catch (err) {
			logger.warn(
				{ cid: cid.toString(), error: String(err) },
				'Failed to save DHT announce status'
			)
		}
	}

	/**
	 * Stop the IPFS node (stop bitswap and libp2p).
	 */
	async stop(): Promise<void> {
		try {
			await this.bitswap.stop()
			await this.libp2p.stop()
		} catch (err) {
			logger.error({ error: String(err) }, 'Error stopping IPFS node')
			throw err
		}
	}
}

/**
 * Factory function to create an IPFSNode.
 * Initializes libp2p with S3 blockstore and datastore.
 */
export async function createIPFSNode(blockstore: Blockstore, datastore: Datastore): Promise<IPFSNode> {
	try {
		logger.info('Opening datastore')
		// S3Datastore doesn't expose an open() method on the interface
		// It handles opening internally when first accessed
		logger.info('Datastore ready')
	} catch (err) {
		logger.error({ error: String(err) }, 'Failed to initialise datastore')
		throw err
	}

	// Create libp2p instance FIRST with unwrapped datastore
	// This avoids issues with libp2p's peer-store initialization
	logger.info('Creating libp2p node (this initializes DHT, peer-store, and services)')
	let libp2p
	try {
		const startTime = Date.now()
		logger.debug('Calling createLibp2pNode...')
		libp2p = await createLibp2pNode(datastore)
		const duration = Date.now() - startTime
		logger.info({ duration }, 'libp2p node created successfully')
	} catch (err) {
		logger.error(
			{
				error: String(err),
				errorName: err instanceof Error ? err.name : 'unknown',
				errorCode: (err as any)?.code,
				stack: err instanceof Error ? err.stack : '',
				message: err instanceof Error ? err.message : String(err),
			},
			'Failed to create libp2p node'
		)
		throw err
	}

	// Wrap datastore for pins operations after libp2p is created
	logger.debug('Wrapping datastore for pin operations')
	const wrappedDatastore = wrapDatastoreWithErrorHandler(datastore)

	// Create and start bitswap for network block retrieval
	logger.debug('Initializing bitswap for network block retrieval')
	let bitswap
	try {
		bitswap = new SimpleBitswap(libp2p, blockstore)
		await bitswap.start()
		logger.info('Bitswap started successfully')
	} catch (err) {
		logger.error({ error: String(err) }, 'Failed to start bitswap')
		throw err
	}

	logger.info(
		{
			peerId: libp2p.peerId.toString(),
			multiaddrs: libp2p.getMultiaddrs().length,
		},
		'IPFS node created successfully'
	)
	return new IPFSNode(libp2p, blockstore, wrappedDatastore, bitswap)
}
