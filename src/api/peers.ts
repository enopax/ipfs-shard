import http from 'http'
import type { RouteContext } from './http-router.js'

export async function handlePeers(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	action: 'list' | 'detailed' | 'detailed-single'
): Promise<boolean> {
	try {
		if (action === 'list') {
			const connections = ctx.node.libp2p.getConnections()
			const peerIds = Array.from(new Set(connections.map((c) => c.remotePeer.toString())))

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ peers: peerIds, count: peerIds.length }))
		} else if (action === 'detailed') {
			const connections = ctx.node.libp2p.getConnections()
			const peers = Array.from(
				new Map(connections.map((conn) => [conn.remotePeer.toString(), conn])).values()
			).map((conn) => ({
				peer: conn.remotePeer.toString(),
				addr: conn.remoteAddr?.toString() || 'unknown',
				direction: conn.direction === 'inbound' ? 'inbound' : 'outbound',
			}))

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ Peers: peers }))
		} else if (action === 'detailed-single') {
			const peerId = (req.url || '').replace('/peers/detailed/', '').split('?')[0]
			const connections = ctx.node.libp2p.getConnections()
			const match = connections.find((c) => c.remotePeer.toString() === peerId)

			if (!match) {
				res.writeHead(404, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Peer not connected' }))
				return true
			}

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(
				JSON.stringify({
					peer: peerId,
					addr: match.remoteAddr?.toString() || 'unknown',
					direction: match.direction === 'inbound' ? 'inbound' : 'outbound',
				})
			)
		}
	} catch (err) {
		res.writeHead(400, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Failed to retrieve peers' }))
	}
	return true
}
