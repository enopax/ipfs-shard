import type { IPFSNode } from '../ipfs-node.js'
import type { Datastore } from 'interface-datastore'
import type { Multiaddr } from '@multiformats/multiaddr'
import { logger } from '../logger.js'
import { loadBackupPeers, saveBackupPeers } from './storage.js'
import { selectPeersToSave } from './selector.js'
import { bootstrapRoundsCounter, bootstrapDialAttemptsCounter } from '../metrics.js'

const BOOTSTRAP_ROUND_INTERVAL_MS = 30_000 // 30 seconds
const BACKUP_SAVE_INTERVAL_MS = 60 * 60 * 1000 // 1 hour
const MIN_PEER_THRESHOLD = 25
const MAX_BACKUP_PEERS = 20

/**
 * Start the backup bootstrap loop.
 * Returns a stop function for graceful shutdown.
 *
 * Kubo algorithm:
 * - Every 30s: if connections < MIN_PEER_THRESHOLD, dial backup peers
 * - Every 1 hour: save current connected peers (minus official bootstrap) as backups
 */
export function startBackupBootstrapLoop(
	node: IPFSNode,
	datastore: Datastore,
	officialBootstrapAddrs: Multiaddr[]
): () => void {
	let stopped = false
	let previouslySaved: Multiaddr[] = []
	let lastSaveTime = Date.now()

	const bootstrapRound = async (trigger: 'timer' | 'disconnect') => {
		if (stopped) return

		try {
			const connections = node.libp2p.getConnections()
			const connectionCount = connections.length

			// If we have enough peers, skip
			if (connectionCount >= MIN_PEER_THRESHOLD) {
				return
			}

			// Increment bootstrap rounds counter
			bootstrapRoundsCounter.inc({ trigger })

			if (connectionCount === 0) {
				logger.warn(
					{ threshold: MIN_PEER_THRESHOLD },
					'Lost all peer connections - attempting immediate bootstrap'
				)
			} else {
				logger.info(
					{ connectionCount, threshold: MIN_PEER_THRESHOLD },
					'Below peer threshold, attempting bootstrap'
				)
			}

			// Load backup peers
			const backupPeers = await loadBackupPeers(datastore)
			if (backupPeers.length === 0) {
				logger.debug('No backup peers available')
				return
			}

			// Try dialing backup peers
			let dialedCount = 0
			for (const peerAddr of backupPeers) {
				if (stopped) break

				try {
					// Parse multiaddr to get peer ID
					const peerId = peerAddr.getPeerId()
					if (!peerId) {
						logger.warn({ addr: peerAddr.toString() }, 'Backup peer has no peer ID')
						continue
					}

					await node.libp2p.dial(peerAddr)
					dialedCount++
					bootstrapDialAttemptsCounter.inc({ result: 'success' })
					logger.debug({ addr: peerAddr.toString() }, 'Dialed backup peer')
				} catch (err) {
					bootstrapDialAttemptsCounter.inc({ result: 'failure' })
					logger.debug(
						{ addr: peerAddr.toString(), error: String(err) },
						'Failed to dial backup peer'
					)
					// Continue trying other peers
				}
			}

			logger.debug(
				{ attemptedCount: backupPeers.length, dialedCount },
				'Bootstrap round complete'
			)
		} catch (err) {
			logger.warn({ error: String(err) }, 'Error during bootstrap round')
		}
	}

	const saveBackupPeersRound = async () => {
		if (stopped) return

		try {
			const connections = node.libp2p.getConnections()
			const connectedAddrs: any[] = []

			// Get multiaddrs of all connected peers
			for (const conn of connections) {
				try {
					const remoteAddr = conn.remoteAddr
					if (remoteAddr) {
						connectedAddrs.push(remoteAddr)
					}
				} catch (err) {
					logger.debug(
						{ error: String(err) },
						'Failed to extract multiaddr from connection'
					)
				}
			}

			// Select peers to save (exclude official bootstrap, cap at max, backfill)
			const peersToSave = selectPeersToSave(
				connectedAddrs,
				officialBootstrapAddrs,
				previouslySaved,
				MAX_BACKUP_PEERS
			)

			// Save to datastore
			await saveBackupPeers(datastore, peersToSave)
			previouslySaved = peersToSave

			logger.info(
				{ savedCount: peersToSave.length, connectedCount: connections.length },
				'Backup peers saved'
			)

			lastSaveTime = Date.now()
		} catch (err) {
			logger.warn({ error: String(err) }, 'Error during backup save round')
		}
	}

	// Start bootstrap round timer (every 30 seconds)
	const bootstrapTimer = setInterval(() => bootstrapRound('timer'), BOOTSTRAP_ROUND_INTERVAL_MS)

	// Start backup save timer (every 1 hour)
	const saveTimer = setInterval(saveBackupPeersRound, BACKUP_SAVE_INTERVAL_MS)

	// Trigger bootstrap immediately when a peer disconnects (below threshold)
	node.libp2p.addEventListener('peer:disconnect', () => {
		const connections = node.libp2p.getConnections()
		if (connections.length < MIN_PEER_THRESHOLD && !stopped) {
			bootstrapRound('disconnect')
		}
	})

	// Try to load previously saved peers on startup
	loadBackupPeers(datastore).then((peers) => {
		previouslySaved = peers
		logger.info(
			{ count: peers.length },
			'Loaded previously saved backup peers on startup'
		)
	})

	const stop = () => {
		if (stopped) return

		stopped = true
		clearInterval(bootstrapTimer)
		clearInterval(saveTimer)
		logger.info('Backup bootstrap loop stopped')
	}

	logger.info('Backup bootstrap loop started')
	return stop
}

// Re-export for convenience
export { loadBackupPeers, saveBackupPeers } from './storage.js'
export { selectPeersToSave } from './selector.js'
