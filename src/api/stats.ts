import http from 'http'
import { CID } from 'multiformats'
import { logger } from '@/logger.js'
import {
	pinsTotalGauge,
	dhtLastAnnounceGauge,
	knownPeersTotalGauge,
	peerAgentVersionsGauge,
	blockRetrieveCounter,
	blockRetrieveDurationHistogram,
} from '@/metrics.js'
import { getQueryParam } from './helpers.js'
import { getDhtStats } from './dht.js'
import type { RouteContext } from './http-router.js'

export async function handleStats(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	action: 'stats' | 'dag-stat' | 'block-stat'
): Promise<boolean> {
	try {
		if (action === 'stats') {
			const { lastAnnouncedAt, totalProvidersAnnounced } = getDhtStats()

			const [pinsList, allPeers, connections] = await Promise.all([
				(async () => {
					try {
						let pinsCount = 0
						for await (const _pin of ctx.node.pins.ls()) {
							pinsCount++
						}
						return pinsCount
					} catch {
						return 0
					}
				})(),
				(async () => {
					try {
						return await ctx.node.libp2p.peerStore.all()
					} catch {
						return []
					}
				})(),
				(async () => {
					try {
						return ctx.node.libp2p.getConnections()
					} catch {
						return []
					}
				})(),
			])

			const agentVersions: Record<string, number> = {}
			const protocolBreakdown: Record<string, number> = {}

			for (const peer of allPeers) {
				try {
					if (peer.metadata) {
						const agentBytes = peer.metadata.get('AgentVersion')
						if (agentBytes) {
							const agent = new TextDecoder().decode(agentBytes)
							agentVersions[agent] = (agentVersions[agent] || 0) + 1
						}
					}
				} catch {
					// Agent version not available
				}

				try {
					if (peer.protocols) {
						for (const protocol of peer.protocols) {
							protocolBreakdown[protocol] = (protocolBreakdown[protocol] || 0) + 1
						}
					}
				} catch {
					// Protocols not available
				}
			}

			if (Object.values(agentVersions).reduce((a, b) => a + b, 0) < allPeers.length) {
				const versionedCount = Object.values(agentVersions).reduce((a, b) => a + b, 0)
				agentVersions['unknown'] = allPeers.length - versionedCount
			}

			const inboundCount = connections.filter((c) => c.direction === 'inbound').length
			const outboundCount = connections.filter((c) => c.direction === 'outbound').length

			const response = {
				pins: { total: pinsList },
				dht: {
					providersAnnounced: totalProvidersAnnounced,
					lastAnnouncedAt: lastAnnouncedAt ? lastAnnouncedAt.toISOString() : null,
					lastAnnouncedAtUnix: lastAnnouncedAt ? Math.floor(lastAnnouncedAt.getTime() / 1000) : -1,
				},
				peers: {
					total: allPeers.length,
					connected: connections.length,
					inbound: inboundCount,
					outbound: outboundCount,
					agentVersions,
					protocolBreakdown,
				},
			}

			pinsTotalGauge.set(pinsList)
			dhtLastAnnounceGauge.set(lastAnnouncedAt ? Math.floor(lastAnnouncedAt.getTime() / 1000) : -1)
			knownPeersTotalGauge.set(allPeers.length)

			const metricData = await peerAgentVersionsGauge.get()
			for (const metricValue of metricData.values) {
				peerAgentVersionsGauge.remove(metricValue.labels)
			}
			for (const [agent, count] of Object.entries(agentVersions)) {
				peerAgentVersionsGauge.set({ agent_version: agent }, count)
			}

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify(response))
		} else if (action === 'dag-stat') {
			const arg = getQueryParam(req.url || '', 'arg')

			if (!arg || typeof arg !== 'string') {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Missing or invalid arg query parameter' }))
				return true
			}

			let cid
			try {
				cid = CID.parse(arg)
			} catch (err) {
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid CID', details: String(err) }))
				return true
			}

			let totalSize: number = 0
			let numBlocks: number = 0

			try {
				const blockExists = await ctx.blockstore.has(cid)
				if (!blockExists) {
					throw new Error('Block not found in local blockstore')
				}

				const t0 = Date.now()
				let blockSize: number = 0
				for await (const chunk of ctx.blockstore.get(cid)) {
					blockSize += chunk.length
				}
				blockRetrieveCounter.inc()
				blockRetrieveDurationHistogram.observe((Date.now() - t0) / 1000)

				totalSize = blockSize
				numBlocks = 1

				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ Size: totalSize, NumBlocks: numBlocks }))
			} catch (err) {
				logger.error({ error: String(err) }, 'Failed to get DAG stat')
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Failed to get DAG stat', details: String(err) }))
			}
		} else if (action === 'block-stat') {
			const arg = getQueryParam(req.url || '', 'arg')

			if (!arg || typeof arg !== 'string') {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Missing or invalid arg query parameter' }))
				return true
			}

			let cid
			try {
				cid = CID.parse(arg)
			} catch (err) {
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid CID', details: String(err) }))
				return true
			}

			try {
				const blockExists = await ctx.blockstore.has(cid)
				if (!blockExists) {
					throw new Error('Block not found in local blockstore')
				}

				let blockSize = 0
				const t0 = Date.now()

				for await (const chunk of ctx.blockstore.get(cid)) {
					blockSize += chunk.length
				}

				blockRetrieveCounter.inc()
				blockRetrieveDurationHistogram.observe((Date.now() - t0) / 1000)

				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ Key: arg, Size: blockSize }))
			} catch (err) {
				logger.error({ error: String(err) }, 'Failed to get block stat')
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Failed to get block stat', details: String(err) }))
			}
		}
	} catch (err) {
		logger.error({ error: String(err) }, 'Failed to handle stats request')
		res.writeHead(500, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Internal server error' }))
	}
	return true
}
