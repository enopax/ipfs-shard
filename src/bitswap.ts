import type { Libp2p, PeerId, Connection, Stream } from '@libp2p/interface'
import { UnsupportedProtocolError } from '@libp2p/interface'
import type { Blockstore } from 'interface-blockstore'
import type { Uint8ArrayList } from 'uint8arraylist'
import { CID } from 'multiformats/cid'
import * as lp from 'it-length-prefixed'
import pDefer from 'p-defer'
import { logger, logBitswap } from './logger.js'
import {
	appendVarint,
	readVarint,
	writeVarintField,
	writeLenField,
	concatBytes,
	encodeWantBlock,
	encodeBlock,
	decodeMessage,
	decodePayloadBlock,
	prefixToCID,
	encodeWithLengthPrefix,
} from './bitswap-codec.js'

const PROTOCOLS = ['/ipfs/bitswap/1.2.0', '/ipfs/bitswap/1.1.0', '/ipfs/bitswap/1.0.0']
// Stream idle timeout: streams are kept alive for persistent communication
// (Not currently used, streams are cleaned up on error or peer disconnect)
const STREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

interface StreamInfo {
	stream: Stream
	direction: 'outbound' | 'inbound'
	createdAt: number
	lastUsed: number
	closed: boolean
}

interface PendingWant {
	deferred: ReturnType<typeof pDefer<Uint8Array>>
	cid: CID
	broadcastedTo: Set<string>
}

/**
 * SimpleBitswap: Custom IPFS bitswap implementation for libp2p v3.
 * Handles block exchange with peers using bidirectional streams.
 *
 * Architecture:
 * - Stream Pool: Maintains persistent bidirectional streams per peer
 * - Unified Read Loop: Both outbound and inbound streams use same handler
 * - Bidirectional Messaging: Wants and blocks exchanged on same stream
 * - Auto-Serving: Peers requesting blocks get served on same stream
 */
export class SimpleBitswap {
	private streamPool = new Map<string, StreamInfo>()
	private pendingWants = new Map<string, PendingWant>()
	private registrarIds: string[] = []
	private unsupportedPeers = new Set<string>()

	constructor(
		private readonly libp2p: Libp2p,
		private readonly blockstore: Blockstore,
	) {}

	async start(): Promise<void> {
		// Register inbound handlers for all protocol versions
		await this.libp2p.handle(PROTOCOLS, (stream: Stream, connection: Connection) => {
			void this._onInboundStream(stream, connection)
		})

		// Register topology only once (for the first protocol).
		// libp2p.register() expects a single string, not an array.
		// This triggers on peer connect/disconnect and handles all protocol versions.
		const id = await this.libp2p.register(PROTOCOLS[0], {
			onConnect: (peerId: PeerId) => {
				if (this.unsupportedPeers.has(peerId.toString())) return
				for (const { cid } of this.pendingWants.values()) {
					void this._sendMessage(peerId, encodeWantBlock(cid)).catch(() => {})
				}
			},
			onDisconnect: (peerId: PeerId) => {
				this._cleanupStream(peerId, 'peer disconnected')
			},
		})
		this.registrarIds.push(id)
		logger.info('SimpleBitswap started')
	}

	async stop(): Promise<void> {
		await this.libp2p.unhandle(PROTOCOLS)
		for (const id of this.registrarIds) {
			this.libp2p.unregister(id)
		}
		this.registrarIds = []

		// Cleanup all streams
		const entries = [...this.streamPool.entries()]
		for (const [, streamInfo] of entries) {
			streamInfo.closed = true
			try {
				streamInfo.stream.close()
			} catch {
				try {
					streamInfo.stream.abort(new Error('bitswap stopped'))
				} catch {
					// Stream already closed
				}
			}
		}
		this.streamPool.clear()

		// Reject all pending wants
		for (const { deferred } of this.pendingWants.values()) {
			deferred.reject(new Error('Bitswap stopped'))
		}
		this.pendingWants.clear()
		logger.info('SimpleBitswap stopped')
	}

	/**
	 * Request a block from the network.
	 * Coalesces duplicate requests and broadcasts want to all connected peers.
	 */
	async want(cid: CID, opts?: { signal?: AbortSignal }): Promise<Uint8Array> {
		const key = cid.toString()

		// Coalesce duplicate requests
		const existing = this.pendingWants.get(key)
		if (existing) return existing.deferred.promise

		const deferred = pDefer<Uint8Array>()
		const pending: PendingWant = {
			deferred,
			cid,
			broadcastedTo: new Set(),
		}
		this.pendingWants.set(key, pending)

		// Handle abort signal
		opts?.signal?.addEventListener('abort', () => {
			this.pendingWants.delete(key)
			deferred.reject(new Error('Aborted'))
		})

		// Broadcast want to all connected peers
		void this._broadcastWant(cid).catch(() => {})

		return deferred.promise
	}

	/**
	 * Broadcast a want to all connected peers.
	 */
	private async _broadcastWant(cid: CID): Promise<void> {
		const key = cid.toString()
		const pending = this.pendingWants.get(key)
		if (!pending) return

		const msg = encodeWantBlock(cid)
		const connCount = this.libp2p.getConnections().length

		await Promise.allSettled(
			this.libp2p.getConnections().map(async (conn) => {
				const peerId = conn.remotePeer.toString()
				if (pending.broadcastedTo.has(peerId)) return
				if (this.unsupportedPeers.has(peerId)) return

				try {
					await this._sendMessage(conn.remotePeer, msg)
					pending.broadcastedTo.add(peerId)
				} catch (err) {
					logBitswap('Failed to broadcast want', {
						peer: peerId,
						cid: cid.toString(),
						error: String(err),
						connCount,
					})
				}
			}),
		)
	}

	/**
	 * Get or create a stream to a peer (outbound).
	 * Reuses existing healthy streams.
	 */
	private async _getOrCreateStream(peerId: PeerId): Promise<Stream> {
		const key = peerId.toString()
		const existing = this.streamPool.get(key)

		// Reuse existing healthy stream
		if (existing && !existing.closed) {
			existing.lastUsed = Date.now()
			logBitswap('Reusing existing bitswap stream', { peer: key, action: 'reuse_stream' })
			return existing.stream
		}

		// Create new outbound stream
		logBitswap('Creating new bitswap stream to peer', { peer: key, action: 'dial_peer' })
		return this._dialPeer(peerId)
	}

	/**
	 * Dial a peer and open an outbound stream.
	 */
	private async _dialPeer(peerId: PeerId): Promise<Stream> {
		const key = peerId.toString()
		try {
			const stream = await this.libp2p.dialProtocol(peerId, PROTOCOLS)

			this.streamPool.set(key, {
				stream,
				direction: 'outbound',
				createdAt: Date.now(),
				lastUsed: Date.now(),
				closed: false,
			})

			logBitswap('Successfully dialed bitswap protocol with peer', { peer: key })

			// Start reading from this stream
			void this._readLoop(peerId, stream)

			return stream
		} catch (err) {
			if (err instanceof UnsupportedProtocolError) {
				this.unsupportedPeers.add(key)
				// No log — expected for non-bitswap peers
			} else {
				logBitswap('Failed to dial bitswap protocol with peer', {
					peer: key,
					error: String(err),
				})
			}
			throw err
		}
	}

	/**
	 * Handle inbound stream from peer.
	 */
	private _onInboundStream(stream: Stream, connection: Connection): void {
		const peerId = connection.remotePeer
		const key = peerId.toString()

		const existing = this.streamPool.get(key)
		if (!existing || existing.direction !== 'outbound') {
			// No outbound stream yet, register this inbound one
			this.streamPool.set(key, {
				stream,
				direction: 'inbound',
				createdAt: Date.now(),
				lastUsed: Date.now(),
				closed: false,
			})
		}

		// Start reading from inbound stream (unified read loop)
		void this._readLoop(peerId, stream)
	}

	/**
	 * Send a message to a peer, reusing or creating stream as needed.
	 */
	private async _sendMessage(peerId: PeerId, message: Uint8Array): Promise<void> {
		const key = peerId.toString()

		try {
			const stream = await this._getOrCreateStream(peerId)
			const prefixed = encodeWithLengthPrefix(message)
			stream.send(prefixed)
			logBitswap('Want sent to peer', { peer: key })
		} catch (err) {
			logBitswap('Error sending want to peer', {
				peer: key,
				error: String(err),
				phase: 'initial_send',
			})
			// Stream is dead, cleanup and retry once
			this._cleanupStream(peerId, `send error: ${String(err)}`)

			try {
				const retryStream = await this._dialPeer(peerId)
				const prefixed = encodeWithLengthPrefix(message)
				retryStream.send(prefixed)
				logBitswap('Want sent to peer (retry)', { peer: key })
			} catch (retryErr) {
				logBitswap('Error sending want to peer (retry failed)', {
					peer: key,
					error: String(retryErr),
					phase: 'retry_send',
				})
				throw retryErr
			}
		}
	}

	/**
	 * Unified read loop for both outbound and inbound streams.
	 * Continuously reads and processes bitswap messages.
	 */
	private async _readLoop(peerId: PeerId, stream: Stream): Promise<void> {
		const key = peerId.toString()
		let buffer: Uint8Array = new Uint8Array(0)

		try {
			for await (const chunk of stream) {
				// Convert chunk to Uint8Array
				const chunkBytes: Uint8Array =
					chunk instanceof Uint8Array ? chunk : new Uint8Array([...(chunk as unknown as Iterable<number>)])
				buffer = concatBytes(buffer, chunkBytes) as Uint8Array

				// Try to decode complete messages
				let offset = 0
				while (offset < buffer.length) {
					// Read varint length prefix
					if (offset >= buffer.length) break

					const [msgLen, lenBytes] = readVarint(buffer, offset)

					// Check if we have the full message
					if (offset + lenBytes + msgLen > buffer.length) {
						// Incomplete message, wait for more data
						buffer = buffer.slice(offset)
						break
					}

					// Extract and process message
					const msg = buffer.slice(offset + lenBytes, offset + lenBytes + msgLen)
					offset += lenBytes + msgLen

					void this._handleMessage(peerId, msg)
				}

				// Keep only unparsed bytes
				if (offset < buffer.length) {
					buffer = buffer.slice(offset)
				} else {
					buffer = new Uint8Array(0)
				}
			}
		} catch (err) {
			logBitswap('Bitswap stream error', { peer: key, err: String(err) })
		} finally {
			this._cleanupStream(peerId, 'stream closed')
		}
	}

	/**
	 * Handle incoming bitswap message.
	 * Processes received blocks and serves blocks for incoming wants.
	 */
	private async _handleMessage(peerId: PeerId, bytes: Uint8Array): Promise<void> {
		const decoded = decodeMessage(bytes)

		// Handle received blocks (resolve pending wants)
		for (const { prefix, data } of decoded.blocks) {
			const cid = await prefixToCID(prefix, data)
			if (!cid) continue

			const key = cid.toString()
			const pending = this.pendingWants.get(key)
			if (pending) {
				this.pendingWants.delete(key)
				try {
					await this.blockstore.put(cid, data)
					logBitswap('Block received from network', { cid: key })
				} catch (err) {
					logBitswap('Failed to store received block', { cid: key, error: String(err) })
				}
				pending.deferred.resolve(data)
			}
		}

		// Handle incoming wants (serve blocks on same stream)
		const streamInfo = this.streamPool.get(peerId.toString())
		if (!streamInfo) return

		for (const cid of decoded.wantBlocks) {
			void this._serveBlockOnStream(peerId, streamInfo, cid).catch(() => {})
		}
	}

	/**
	 * Serve a block to a peer on their stream.
	 */
	private async _serveBlockOnStream(peerId: PeerId, streamInfo: StreamInfo, cid: CID): Promise<void> {
		try {
			const result = await this.blockstore.get(cid)
			const data = result as unknown as Uint8Array
			const msg = encodeBlock(cid, data)
			const prefixed = encodeWithLengthPrefix(msg)
			streamInfo.stream.send(prefixed)
			logBitswap('Block served to peer', { peer: peerId.toString(), cid: cid.toString() })
		} catch {
			// Don't have block, silently skip
		}
	}

	/**
	 * Cleanup a stream for a peer.
	 */
	private _cleanupStream(peerId: PeerId, reason: string): void {
		const key = peerId.toString()
		const streamInfo = this.streamPool.get(key)

		if (!streamInfo) return

		streamInfo.closed = true
		this.streamPool.delete(key)

		try {
			streamInfo.stream.close()
		} catch {
			try {
				streamInfo.stream.abort(new Error(reason))
			} catch {
				// Stream already closed
			}
		}

		logBitswap('Bitswap stream cleaned up', { peer: key, reason })
	}

	/**
	 * Clear the set of peers known to not support bitswap.
	 * Called periodically to reset the blocklist and retry unsupported peers.
	 */
	clearUnsupportedPeers(): void {
		this.unsupportedPeers.clear()
	}

}
