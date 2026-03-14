import http from 'http'
import { multiaddr } from '@multiformats/multiaddr'
import { logger } from '@/logger.js'
import { parseJsonBody } from './helpers.js'
import type { RouteContext } from './http-router.js'

export async function handleConnections(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	action: 'list' | 'connect' | 'ping'
): Promise<boolean> {
	try {
		if (action === 'list') {
			const connections = ctx.node.libp2p.getConnections()
			const connectionsList = connections.map((conn) => {
				const timeline = (conn as any).timeline || {}
				return {
					id: conn.id,
					remotePeer: conn.remotePeer.toString(),
					remoteAddr: conn.remoteAddr?.toString() || 'unknown',
					direction: conn.direction === 'inbound' ? 'inbound' : 'outbound',
					status: (conn as any).status || 'open',
					encryption: conn.encryption ?? null,
					multiplexer: conn.multiplexer ?? null,
					direct: true,
					timeline: { open: timeline.open || Date.now() },
				}
			})

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ connections: connectionsList, count: connectionsList.length }))
		} else if (action === 'connect') {
			const body = await parseJsonBody(req)
			const peerStr = body.peer

			if (!peerStr || typeof peerStr !== 'string') {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Missing or invalid peer field' }))
				return true
			}

			let ma
			try {
				ma = multiaddr(peerStr)
			} catch (err) {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid multiaddr', details: String(err) }))
				return true
			}

			try {
				await ctx.node.libp2p.dial(ma)
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true, peer: peerStr }))
			} catch (err) {
				logger.error({ peer: peerStr, error: String(err) }, 'Failed to connect to peer')
				res.writeHead(503, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Failed to connect to peer', details: String(err) }))
			}
		} else if (action === 'ping') {
			const body = await parseJsonBody(req)
			const peerStr = body.peer

			if (!peerStr || typeof peerStr !== 'string') {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Missing or invalid peer field' }))
				return true
			}

			let ma
			try {
				ma = multiaddr(peerStr)
			} catch (err) {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid multiaddr', details: String(err) }))
				return true
			}

			try {
				const pingService = ctx.node.libp2p.services.ping as any
				let latency: number | undefined
				if (pingService && typeof pingService.ping === 'function') {
					latency = await pingService.ping(ma)
				}

				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ latency }))
			} catch (err) {
				logger.error({ peer: peerStr, error: String(err) }, 'Ping failed')
				res.writeHead(503, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Ping failed', details: String(err) }))
			}
		}
	} catch (err) {
		res.writeHead(400, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Invalid JSON body' }))
	}
	return true
}
