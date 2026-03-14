import http from 'http'
import { updateNodeMetrics, getMetricsString } from '@/metrics.js'
import { logger } from '@/logger.js'
import type { RouteContext } from './http-router.js'

export async function handleMetrics(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse
): Promise<boolean> {
	try {
		updateNodeMetrics(ctx.node, ctx.version)
		const metrics = await getMetricsString()

		res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
		res.end(metrics)
	} catch (err) {
		logger.error({ error: String(err) }, 'Failed to get metrics')
		res.writeHead(500, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Internal server error' }))
	}
	return true
}
