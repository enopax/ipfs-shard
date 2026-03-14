import { register, Counter, Gauge, Histogram, collectDefaultMetrics } from 'prom-client'
import type { IPFSNode } from './ipfs-node.js'
import { logger } from './logger.js'

/**
 * Initialise Prometheus metrics for IPFS node.
 * Exposes connection, peer, and operation metrics.
 */

// Guard to prevent double registration (handles tsx loading same module twice)
try {
	collectDefaultMetrics({ register })
} catch (err) {
	// Already registered, ignore
}

// Helper to safely create metrics without collision
function createGauge<T extends string>(name: string, help: string, labelNames?: readonly T[]): Gauge<T> {
	const existing = register.getSingleMetric(name)
	if (existing) return existing as Gauge<T>
	return new Gauge({ name, help, labelNames: labelNames || [], registers: [register] })
}

function createCounter(name: string, help: string, labelNames?: readonly string[]): Counter {
	const existing = register.getSingleMetric(name)
	if (existing) return existing as Counter
	return new Counter({ name, help, labelNames: labelNames || [], registers: [register] })
}

function createHistogram(name: string, help: string, opts?: { buckets?: number[]; labelNames?: readonly string[] }): Histogram {
	const existing = register.getSingleMetric(name)
	if (existing) return existing as Histogram
	return new Histogram({ name, help, registers: [register], labelNames: opts?.labelNames || [], buckets: opts?.buckets })
}

// ============================================================================
// Connection & Peer Metrics
// ============================================================================

export const connectedPeersGauge = createGauge('ipfs_connected_peers', 'Number of connected peers')

export const connectionsGauge = createGauge('ipfs_connections', 'Number of libp2p connections')

export const inboundConnectionsGauge = createGauge('ipfs_inbound_connections', 'Number of inbound connections')

export const outboundConnectionsGauge = createGauge('ipfs_outbound_connections', 'Number of outbound connections')

export const connectionStatusGauge = createGauge('ipfs_connection_status', 'Connection status per peer (1 = open, 0 = closed)', ['peer_id', 'remote_addr', 'direction'])

export const peerConnectCounter = createCounter('ipfs_peer_connect_total', 'Total peer connect events')

export const peerDisconnectCounter = createCounter('ipfs_peer_disconnect_total', 'Total peer disconnect events')

export const bootstrapRoundsCounter = createCounter('ipfs_bootstrap_rounds_total', 'Number of backup bootstrap rounds that ran below threshold', ['trigger'])

export const bootstrapDialAttemptsCounter = createCounter('ipfs_bootstrap_dial_attempts_total', 'Backup peer dial attempts during bootstrap', ['result'])

// ============================================================================
// Node Information Metrics
// ============================================================================

export const nodeInfoGauge = createGauge('ipfs_node_info', 'Node information (version, peer ID)', ['peer_id', 'version'])

export const multiaddrsGauge = createGauge('ipfs_multiaddrs', 'Number of multiaddresses announced by this node')

export const uptimeGauge = createGauge('ipfs_uptime_seconds', 'Node uptime in seconds')

// ============================================================================
// Block & Storage Metrics
// ============================================================================

export const blockAddCounter = createCounter('ipfs_blocks_added_total', 'Total number of blocks added')

export const blockAddErrorCounter = createCounter('ipfs_block_add_errors_total', 'Total number of block add errors')

export const blockRetrieveCounter = createCounter('ipfs_blocks_retrieved_total', 'Total number of blocks retrieved')

export const blockRetrieveErrorCounter = createCounter('ipfs_block_retrieve_errors_total', 'Total number of block retrieve errors')

export const blockRetrieveDurationHistogram = createHistogram('ipfs_block_retrieve_duration_seconds', 'Duration of block retrieval operations', { buckets: [0.01, 0.05, 0.1, 0.5, 1.0, 5.0] })

export const blockAddDurationHistogram = createHistogram('ipfs_block_add_duration_seconds', 'Duration of block add operations', { buckets: [0.01, 0.05, 0.1, 0.5, 1.0, 5.0] })

// ============================================================================
// Content Announcement Metrics
// ============================================================================

export const contentAnnounceCounter = createCounter('ipfs_content_announced_total', 'Total number of content announcements to DHT')

export const contentAnnounceErrorCounter = createCounter('ipfs_content_announce_errors_total', 'Total number of content announcement errors')

export const providerQueriesCounter = createCounter('ipfs_provider_queries_total', 'Total number of provider queries')

export const providersFoundGauge = createGauge('ipfs_providers_found', 'Number of providers found in last query')

// ============================================================================
// Pin & Storage Metrics
// ============================================================================

export const pinsTotalGauge = createGauge('ipfs_pins_total', 'Total number of pinned CIDs')

// ============================================================================
// DHT Metrics
// ============================================================================

export const dhtLastAnnounceGauge = createGauge('ipfs_dht_last_announce_unix', 'Unix timestamp of last content announcement to DHT (−1 if never)')

// ============================================================================
// Peer Metrics
// ============================================================================

export const knownPeersTotalGauge = createGauge('ipfs_known_peers_total', 'Total number of known peers in peerStore')

export const peerAgentVersionsGauge = createGauge('ipfs_peer_agent_versions', 'Count of peers by agent version string', ['agent_version'])

// ============================================================================
// Re-provide Metrics
// ============================================================================

export const reprovideCounter = createCounter('ipfs_reprovide_total', 'Total number of successful content re-provisions to DHT')

export const reprovideErrorCounter = createCounter('ipfs_reprovide_errors_total', 'Total number of content re-provision errors')

export const reprovideLastRunGauge = createGauge('ipfs_reprovide_last_run_unix', 'Unix timestamp of the last re-provide loop run')

export const reprovideDurationGauge = createGauge('ipfs_reprovide_duration_seconds', 'Duration of the last re-provide loop run in seconds')

// ============================================================================
// API Endpoint Metrics
// ============================================================================

export const httpRequestsCounter = createCounter('ipfs_http_requests_total', 'Total HTTP requests', ['method', 'path', 'status'])

export const httpRequestDurationHistogram = createHistogram('ipfs_http_request_duration_seconds', 'HTTP request duration', { labelNames: ['method', 'path'], buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1.0] })

// ============================================================================
// Update Functions
// ============================================================================

/**
 * Update metrics with current IPFS node state.
 */
export function updateNodeMetrics(node: IPFSNode, version: string): void {
	try {
		const peers = node.libp2p.getPeers()
		const connections = node.libp2p.getConnections()
		const multiaddrs = node.libp2p.getMultiaddrs()

		// Update peer and connection metrics
		connectedPeersGauge.set(peers.length)
		connectionsGauge.set(connections.length)

	const inboundCount = connections.filter((c) => c.direction === 'inbound').length
	const outboundCount = connections.filter((c) => c.direction === 'outbound').length

	inboundConnectionsGauge.set(inboundCount)
	outboundConnectionsGauge.set(outboundCount)

	// Update per-connection status
	for (const conn of connections) {
		connectionStatusGauge.set(
			{
				peer_id: conn.remotePeer.toString(),
				remote_addr: conn.remoteAddr.toString(),
				direction: conn.direction,
			},
			conn.status === 'open' ? 1 : 0
		)
	}

	// Update node info
	const peerId = node.libp2p.peerId.toString()
	nodeInfoGauge.set({ peer_id: peerId, version }, 1)

	// Update multiaddrs
	multiaddrsGauge.set(multiaddrs.length)

	// Update uptime
	uptimeGauge.set(Math.floor(process.uptime()))
	} catch (err) {
		logger.error({ error: String(err), stack: String(err instanceof Error ? err.stack : 'no stack') }, 'Failed to update node metrics')
	}
}

/**
 * Get Prometheus metrics as a string.
 */
export async function getMetricsString(): Promise<string> {
	return await register.metrics()
}

/**
 * Get metrics in OpenMetrics format.
 */
export async function getMetricsOpenMetrics(): Promise<string> {
	return await register.metrics()
}
