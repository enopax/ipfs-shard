import type { Datastore } from 'interface-datastore'
import type { Multiaddr } from '@multiformats/multiaddr'
import { logger, logDHT } from '@/logger.js'
import { startBackupBootstrapLoop } from '@/backup-bootstrap/index.js'
import { startReprovideLoop } from '@/reprovide.js'
import { webcrypto as crypto } from 'node:crypto'

/**
 * Poll for peer connections with retries (up to 30s).
 * Prevents premature announce calls before the node is ready.
 */
export async function waitForPeerConnections(node: any, maxWaitMs: number = 30000): Promise<void> {
	const startTime = Date.now()
	const pollIntervalMs = 500

	while (Date.now() - startTime < maxWaitMs) {
		const connections = node.libp2p.getConnections()
		if (connections.length > 0) {
			logger.info(
				{ connectionCount: connections.length },
				'Peer connections established'
			)
			return
		}

		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
	}

	logger.warn(
		{ maxWaitMs },
		'Timeout waiting for peer connections; proceeding with zero connections'
	)
}

/**
 * Periodically dial bootstrap peers to maintain connections.
 * Runs every 30 seconds, attempting to connect to any bootstrap peers
 * that aren't already connected.
 *
 * Returns a stop function for graceful shutdown.
 */
export function startBootstrapDialLoop(node: any, bootstrapAddrs: Multiaddr[]): () => void {
	if (bootstrapAddrs.length === 0) {
		logger.debug('No bootstrap peers configured, skipping bootstrap dial loop')
		return () => {}
	}

	let stopped = false
	const DIAL_INTERVAL_MS = 30_000 // 30 seconds

	const dialBootstrapPeers = async () => {
		if (stopped) return

		try {
			const connectedPeerIds = new Set(node.libp2p.getConnections().map((c) => c.remotePeer.toString()))

			let dialedCount = 0
			for (const bootstrapAddr of bootstrapAddrs) {
				if (stopped) break

				const peerId = bootstrapAddr.getPeerId()
				if (!peerId) {
					logger.warn({ addr: bootstrapAddr.toString() }, 'Bootstrap peer has no peer ID')
					continue
				}

				// Skip if already connected
				if (connectedPeerIds.has(peerId)) {
					continue
				}

				try {
					await node.libp2p.dial(bootstrapAddr)
					dialedCount++
					logger.debug(
						{ addr: bootstrapAddr.toString(), peerId },
						'Successfully dialed bootstrap peer'
					)
				} catch (err) {
					logger.debug(
						{ addr: bootstrapAddr.toString(), peerId, error: String(err) },
						'Failed to dial bootstrap peer'
					)
					// Continue trying other bootstrap peers
				}
			}

			if (dialedCount > 0) {
				logger.info(
					{ dialedCount, totalBootstrapPeers: bootstrapAddrs.length },
					'Bootstrap dial round completed'
				)
			}
		} catch (err) {
			logger.warn({ error: String(err) }, 'Error during bootstrap dial round')
		}
	}

	// Start timer to dial bootstrap peers every 30 seconds
	const dialTimer = setInterval(dialBootstrapPeers, DIAL_INTERVAL_MS)

	// Dial bootstrap peers immediately on startup
	dialBootstrapPeers()

	const stop = () => {
		if (stopped) return
		stopped = true
		clearInterval(dialTimer)
		logger.info('Bootstrap dial loop stopped')
	}

	logger.info(
		{ bootstrapPeerCount: bootstrapAddrs.length, intervalMs: DIAL_INTERVAL_MS },
		'Bootstrap dial loop started'
	)
	return stop
}

/**
 * Aggressively announce to DHT via random key puts.
 * Each put operation causes DHT to connect to peers and discover them.
 * This is what triggers the peer spam in logs (constant peer connect/disconnect).
 */
export function startDHTDiscoveryLoop(node: any): () => void {
	let stopped = false
	const DHT_ANNOUNCE_INTERVAL_MS = 5_000 // 5 seconds - very aggressive (every 5s announce)
	let announceCounter = 0

	const announceToNetwork = async () => {
		if (stopped) return
		try {
			const dhtService = node.libp2p.services.dht
			if (!dhtService) return

			announceCounter++
			const connectedCount = node.libp2p.getConnections().length

			// Generate random key to announce
			// Each announcement triggers DHT puts which cause peer discovery
			const randomBytes = new Uint8Array(32)
			crypto.getRandomValues(randomBytes)
			const announceKey = randomBytes

			try {
				// Put the key in DHT - this triggers peer connections and discovery
				const putEvents: any[] = []
				for await (const event of dhtService.put(announceKey, randomBytes, {
					timeout: 3000,
				})) {
					putEvents.push(event)
				}

				logDHT(
					'DHT announcement sent',
					{ connectedCount, announceCounter, putEvents: putEvents.length }
				)
			} catch (err) {
				// Timeout is expected - we triggered the DHT puts
				logDHT(
					'DHT announcement completed',
					{ connectedCount, announceCounter, error: String(err) }
				)
			}
		} catch (err) {
			logDHT('DHT announcement error', { error: String(err) })
		}
	}

	// Start timer for aggressive DHT announcements
	const announceTimer = setInterval(announceToNetwork, DHT_ANNOUNCE_INTERVAL_MS)

	// Announce immediately on startup
	announceToNetwork()

	const stop = () => {
		if (stopped) return
		stopped = true
		clearInterval(announceTimer)
		logger.info('DHT announcement loop stopped')
	}

	logger.info(
		{ intervalMs: DHT_ANNOUNCE_INTERVAL_MS },
		'DHT announcement loop started (periodic network announcements)'
	)
	return stop
}

/**
 * Start background loops (bootstrap, DHT discovery, re-provide, peer maintenance).
 */
export function startBackgroundLoops(
	node: any,
	datastore: Datastore,
	bootstrapMultiaddrs: Multiaddr[]
): Array<() => void> {
	const stopFunctions: Array<() => void> = []

	// Bootstrap dial loop
	const stopBootstrapDial = startBootstrapDialLoop(node, bootstrapMultiaddrs)
	stopFunctions.push(stopBootstrapDial)

	// DHT discovery loop
	const stopDHTDiscovery = startDHTDiscoveryLoop(node)
	stopFunctions.push(stopDHTDiscovery)

	// Backup bootstrap loop
	const stopBackupBootstrap = startBackupBootstrapLoop(node, datastore, bootstrapMultiaddrs)
	stopFunctions.push(stopBackupBootstrap)

	// Reprovide loop
	const stopReprovide = startReprovideLoop(node)
	stopFunctions.push(stopReprovide)

	// Clear unsupported peers timer
	const clearUnsupportedPeersTimer = setInterval(
		() => node.bitswap.clearUnsupportedPeers(),
		10 * 60 * 1000
	)
	stopFunctions.push(() => clearInterval(clearUnsupportedPeersTimer))

	return stopFunctions
}
