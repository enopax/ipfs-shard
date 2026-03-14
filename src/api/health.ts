import http from 'http'
import type { RouteContext } from './http-router.js'

export async function handleHealth(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse
): Promise<boolean> {
	const connections = ctx.node.libp2p.getConnections()
	const multiaddrs = ctx.node.libp2p.getMultiaddrs()
	const uptime = Math.floor(process.uptime())

	let s3Status: 'ok' | 'degraded' | 'unknown' = 'unknown'
	if (ctx.checkS3Health) {
		try {
			const s3Healthy = await ctx.checkS3Health()
			s3Status = s3Healthy ? 'ok' : 'degraded'
		} catch {
			s3Status = 'degraded'
		}
	}

	const response = {
		peerId: ctx.node.libp2p.peerId.toString(),
		agentVersion: `ipfs-shard/${ctx.version}`,
		protocolVersion: 'ipfs/1.0.0',
		connections: connections.length,
		dhtMode: 'server',
		uptime,
		multiaddrs: multiaddrs.map((ma) => ma.toString()),
		storage: {
			s3: s3Status,
		},
	}

	res.writeHead(200, { 'Content-Type': 'application/json' })
	res.end(JSON.stringify(response))
	return true
}
