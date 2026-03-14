import { createLibp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { identify } from '@libp2p/identify'
import { ping } from '@libp2p/ping'
import { bootstrap } from '@libp2p/bootstrap'
import { kadDHT } from '@libp2p/kad-dht'
import { FaultTolerance } from '@libp2p/interface'
import type { Libp2p } from '@libp2p/interface'
import type { Datastore } from 'interface-datastore'
import { logger } from './logger.js'

const LIBP2P_PORT = parseInt(process.env.LIBP2P_PORT || '4001', 10)
const LIBP2P_WS_PORT = parseInt(process.env.LIBP2P_WS_PORT || '4002', 10)
const ANNOUNCE_IP = process.env.ANNOUNCE_IP || '127.0.0.1'

export const BOOTSTRAP_PEERS = (process.env.BOOTSTRAP_PEERS ?? '')
	.split(',')
	.map((p) => p.trim())
	.filter((p) => p.length > 0)

export async function createLibp2pNode(datastore: Datastore): Promise<Libp2p> {
	logger.info(
		{
			bootstrapPeerCount: BOOTSTRAP_PEERS.length,
			bootstrapPeers: BOOTSTRAP_PEERS.slice(0, 2).map((p) => p.substring(0, 60) + '...'), // Log first 2 for debugging
			libp2pPort: LIBP2P_PORT,
			libp2pWsPort: LIBP2P_WS_PORT,
			announceIp: ANNOUNCE_IP,
		},
		'Configuring libp2p node'
	)

	// Build peer discovery array
	const peerDiscovery = BOOTSTRAP_PEERS.length > 0 ? [bootstrap({ list: BOOTSTRAP_PEERS })] : []
	logger.debug({ peerDiscoveryEnabled: peerDiscovery.length > 0 }, 'Peer discovery configured')

	try {
		logger.debug('Initializing transports (TCP, WebSockets)...')
		logger.debug('Initializing connection encrypters (Noise)...')
		logger.debug('Initializing stream muxers (Yamux)...')
		logger.debug('Initializing services (Identify, Ping, DHT)...')

		const libp2p = await createLibp2p({
			datastore,
			addresses: {
				listen: [
					`/ip4/0.0.0.0/tcp/${LIBP2P_PORT}`,
					`/ip4/0.0.0.0/tcp/${LIBP2P_WS_PORT}/ws`,
				],
				announce: [
					`/ip4/${ANNOUNCE_IP}/tcp/${LIBP2P_PORT}`,
				],
			},
			transports: [tcp(), webSockets()],
			connectionEncrypters: [noise()],
			streamMuxers: [yamux()],
			transportManager: {
				faultTolerance: FaultTolerance.NO_FATAL, // Allow startup if one transport fails (e.g. port in TIME_WAIT during tests)
			},
			connectionManager: {
				maxConnections: 300, // HighWater: prune when exceeding (Kubo full-node range)
				maxParallelDials: 100, // Dial 100 peers in parallel for aggressive discovery
				dialTimeout: 5000, // 5s timeout per dial (fail fast)
				maxDialQueueLength: 500, // Queue up many dial attempts for discovery bursts
				maxPeerAddrsToDial: 50, // Try multiple addresses per peer
			},
			peerDiscovery,
			services: {
				identify: identify(),
				ping: ping(),
				dht: kadDHT({
					clientMode: false, // Full DHT server — attracts inbound connections
					// Tune DHT for faster peer discovery
					kBucketSize: 20, // Standard bucket size
					kBucketSplitThreshold: 20, // Split buckets aggressively
				}),
			},
		})

		const multiaddrs = libp2p.getMultiaddrs()
		logger.info(
			{
				peerId: libp2p.peerId.toString(),
				multiaddrs: multiaddrs.map((m) => m.toString()),
				listenAddressCount: multiaddrs.length,
			},
			'libp2p node created and listening'
		)

		return libp2p
	} catch (err) {
		logger.error(
			{
				error: String(err),
				errorName: err instanceof Error ? err.name : 'unknown',
				errorCode: (err as any)?.code,
				phase: 'libp2p_creation',
			},
			'Failed during libp2p node creation'
		)
		throw err
	}
}
