import http from 'http'
import type { Blockstore } from 'interface-blockstore'
import type { IPFSNode } from '@/ipfs-node.js'
import { logger } from '@/logger.js'
import { normalisePath } from '@/api/helpers.js'
import { httpRequestsCounter, httpRequestDurationHistogram } from '@/metrics.js'
import { createApiRouter } from '@/api/http-router.js'

export interface InternalAPIOptions {
	node: IPFSNode
	blockstore: Blockstore
	port: number
	version?: string
	checkS3Health?: () => Promise<boolean>
}

function getClientIp(req: http.IncomingMessage): string {
	const forwarded = req.headers['x-forwarded-for']
	if (typeof forwarded === 'string') {
		return forwarded.split(',')[0].trim()
	}
	return req.socket?.remoteAddress || 'unknown'
}

export async function startInternalAPI(options: InternalAPIOptions): Promise<http.Server> {
	const { node, blockstore, port, version = '0.0.0', checkS3Health } = options

	const server = http.createServer(async (req, res) => {
		const startTime = Date.now()
		const clientIp = getClientIp(req)
		const method = req.method || ''
		const path = req.url || '/'

		// Wrap response.end to log request details and record metrics
		const originalEnd = res.end.bind(res)
		res.end = function (...args: any[]) {
			const duration = Date.now() - startTime
			logger.info(
				{
					clientIp,
					method,
					path,
					statusCode: res.statusCode,
					durationMs: duration,
				},
				'API request'
			)
			// Record HTTP metrics
			httpRequestsCounter.inc({
				method,
				path: normalisePath(path),
				status: String(res.statusCode),
			})
			httpRequestDurationHistogram.observe(
				{ method, path: normalisePath(path) },
				duration / 1000
			)
			return originalEnd(...args)
		}

		try {
			// Route request to appropriate handler
			const handled = await createApiRouter(
				{ node, blockstore, version, checkS3Health },
				req,
				res
			)

			if (!handled) {
				res.writeHead(404, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Not found' }))
			}
		} catch (err) {
			logger.error({ error: String(err) }, 'Internal API error')
			if (!res.headersSent) {
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Internal server error' }))
			}
		}
	})

	return new Promise((resolve, reject) => {
		server.listen(port, '0.0.0.0', () => {
			logger.info({ port, host: '0.0.0.0' }, 'Internal API server started')
			resolve(server)
		})
		server.on('error', reject)
	})
}
