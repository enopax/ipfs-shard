import 'dotenv/config'
import type { Blockstore } from 'interface-blockstore'
import type { Datastore } from 'interface-datastore'
import { logger, logPeer } from './logger.js'
import { createIPFSNode } from './ipfs-node.js'
import { startInternalAPI } from './internal-api.js'
import { LRUBlockstore } from './blockstore-cache.js'
import { NetworkAwareBlockstore } from './blockstore-network.js'
import { BOOTSTRAP_PEERS } from './libp2p-config.js'
import { peerConnectCounter, peerDisconnectCounter } from './metrics.js'
import { multiaddr } from '@multiformats/multiaddr'
import { readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

import { validateEnv, isMemoryStorageEnabled } from './startup/env.js'
import { setupStorage, createS3HealthCheck } from './startup/storage.js'
import { waitForPeerConnections, startBackgroundLoops } from './startup/loops.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = __filename.split('/').slice(0, -1).join('/')
const packageJson = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'))
const VERSION = packageJson.version

/**
 * Set up IPFS node with blockstore wrappers.
 */
async function setupIPFSNode(
	rawBlockstore: Blockstore,
	datastore: Datastore
): Promise<{
	node: any
	blockstore: Blockstore
}> {
	const node = await createIPFSNode(rawBlockstore, datastore)
	const networkAwareBlockstore = new NetworkAwareBlockstore(rawBlockstore, node.bitswap, node.libp2p)

	const BLOCK_CACHE_MB = parseInt(process.env.BLOCK_CACHE_MB || '0', 10)
	const blockstore =
		BLOCK_CACHE_MB > 0 ? new LRUBlockstore(networkAwareBlockstore, BLOCK_CACHE_MB) : networkAwareBlockstore

	if (BLOCK_CACHE_MB > 0) {
		logger.info({ sizeMB: BLOCK_CACHE_MB }, 'LRU block cache enabled')
	}

	return { node, blockstore }
}

/**
 * Main application entry point.
 */
async function main(): Promise<void> {
	try {
		validateEnv()

		// Set up storage
		const { s3Client, rawBlockstore, datastore } = await setupStorage()

		// Set up IPFS node
		const { node, blockstore } = await setupIPFSNode(rawBlockstore, datastore)

		const internalPort = parseInt(process.env.NODE_INTERNAL_PORT || '3001', 10)
		const internalHost = process.env.API_HOST ?? '0.0.0.0'

		// Create S3 health check
		const checkS3Health = createS3HealthCheck(s3Client)

		// Convert BOOTSTRAP_PEERS strings to Multiaddr objects
		const bootstrapMultiaddrs = BOOTSTRAP_PEERS.map((addr) => multiaddr(addr))

		// Monitor peer discovery and connection events for diagnostics
		node.libp2p.addEventListener('peer:discovery', (event) => {
			logPeer('Peer discovered', { peerId: event.detail.id.toString() })
		})

		node.libp2p.addEventListener('peer:connect', (event) => {
			peerConnectCounter.inc()
			logPeer('Peer connected', { count: node.libp2p.getConnections().length })
		})

		node.libp2p.addEventListener('peer:disconnect', (event) => {
			peerDisconnectCounter.inc()
			logPeer('Peer disconnected', { count: node.libp2p.getConnections().length })
		})

		// Wait for at least one peer connection before starting API
		// Skip in memory mode for faster startup during development
		if (!isMemoryStorageEnabled()) {
			await waitForPeerConnections(node)
		} else {
			logger.debug('Skipping peer connection wait in memory mode')
		}

		const apiServer = await startInternalAPI({
			node,
			blockstore,
			port: internalPort,
			host: internalHost,
			version: VERSION,
			checkS3Health,
		})

		// Start background loops
		const stopFunctions = startBackgroundLoops(node, datastore, bootstrapMultiaddrs)

		logger.info(
			{
				peerId: node.libp2p.peerId.toString(),
				multiaddrs: node.libp2p.getMultiaddrs().map((ma) => ma.toString()),
				internalApiPort: internalPort,
			},
			'IPFS DHT node started'
		)

		// Graceful shutdown
		async function shutdown(signal: string) {
			logger.info(`Received ${signal}, shutting down gracefully`)
			try {
				stopFunctions.forEach((fn) => fn())
				await new Promise<void>((resolve) => apiServer.close(() => resolve()))
				await node.stop()
				logger.info('Shutdown complete')
				process.exit(0)
			} catch (err) {
				logger.error({ error: String(err) }, 'Error during shutdown')
				process.exit(1)
			}
		}

		process.on('SIGTERM', () => shutdown('SIGTERM'))
		process.on('SIGINT', () => shutdown('SIGINT'))
	} catch (err) {
		logger.error({ error: String(err) }, 'Fatal error, exiting')
		process.exit(1)
	}
}

main()
