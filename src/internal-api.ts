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
	host?: string
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
	const { node, blockstore, port, host = '0.0.0.0', version = '0.0.0', checkS3Health } = options

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

	// --- CORS & API Key ---
	const isDev = process.env.NODE_ENV === 'development'

	// CORS
	let corsOrigin = '*'
	if (!isDev) {
		const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
			.split(',').map(s => s.trim()).filter(Boolean)
		const requestOrigin = req.headers['origin']
		if (allowedOrigins.length > 0) {
			if (typeof requestOrigin === 'string' && allowedOrigins.includes(requestOrigin)) {
				corsOrigin = requestOrigin
			} else {
				corsOrigin = allowedOrigins[0]
			}
		}
	}
	res.setHeader('Access-Control-Allow-Origin', corsOrigin)
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')
	res.setHeader('Access-Control-Max-Age', '86400')

	if (method === 'OPTIONS') {
		res.writeHead(204)
		res.end()
		return
	}

	// --- API Key ---
	const apiKey = process.env.API_KEY
	if (!isDev && apiKey) {
		const provided = req.headers['x-api-key']
		if (!provided) {
			res.writeHead(401, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ error: 'Authentication required' }))
			return
		}
		if (provided !== apiKey) {
			res.writeHead(403, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ error: 'Forbidden' }))
			return
		}
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
		server.listen(port, host, () => {
			logger.info({ port, host }, 'Internal API server started')
			resolve(server)
		})
		server.on('error', reject)
	})
}
