import http from 'http'
import { CID } from 'multiformats'
import { logger } from '@/logger.js'
import { pinsTotalGauge } from '@/metrics.js'
import { parseJsonBody } from './helpers.js'
import { announceContent } from './dht.js'
import type { RouteContext } from './http-router.js'

export async function handlePins(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	action: 'list' | 'add' | 'remove'
): Promise<boolean> {
	try {
		if (action === 'list') {
			const pins: string[] = []
			for await (const { cid } of ctx.node.pins.ls()) {
				pins.push(cid.toString())
			}
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ pins, count: pins.length }))
		} else if (action === 'add') {
			const body = await parseJsonBody(req)
			const cidStr = body.cid as any

			if (!cidStr || typeof cidStr !== 'string') {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Missing or invalid cid field' }))
				return true
			}

			try {
				const cid = CID.parse(cidStr)
				await ctx.node.pins.add(cid)
				pinsTotalGauge.inc()
				logger.info({ cid: cidStr }, 'Content pinned')

				const isUsingMockStorage = typeof ctx.blockstore.get === 'function' &&
					!ctx.blockstore.constructor.name.includes('S3')
				if (!isUsingMockStorage) {
					let blockExists = false
					try {
						blockExists = await ctx.blockstore.has(cid)
					} catch {
						blockExists = false
					}
					if (!blockExists) {
						logger.warn({ cid: cidStr }, 'Pinned CID block not found in local blockstore')
					}
				}

				announceContent(ctx, cid, cidStr).catch((err) => {
					logger.warn({ cid: cidStr, error: String(err) }, 'Auto-announce after pin failed')
				})

				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true, cid: cidStr }))
			} catch (err) {
				const isValidationError = err instanceof Error && (err.message.includes('multibase decoder') || err.message.includes('Unexpected end'))
				const logLevel = isValidationError ? 'debug' : 'error'
				logger[logLevel]({ cid: cidStr, error: String(err) }, 'Failed to pin content')
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Failed to pin content', details: String(err) }))
			}
		} else if (action === 'remove') {
			const body = await parseJsonBody(req)
			const cidStr = body.cid

			if (!cidStr || typeof cidStr !== 'string') {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Missing or invalid cid field' }))
				return true
			}

			try {
				const cid = CID.parse(cidStr)
				await ctx.node.pins.rm(cid)
				pinsTotalGauge.dec()
				logger.info({ cid: cidStr }, 'Content unpinned')

				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true, cid: cidStr }))
			} catch (err) {
				const isValidationError = err instanceof Error && (err.message.includes('multibase decoder') || err.message.includes('Unexpected end'))
				const logLevel = isValidationError ? 'debug' : 'error'
				logger[logLevel]({ cid: cidStr, error: String(err) }, 'Failed to unpin content')
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Failed to unpin content', details: String(err) }))
			}
		}
	} catch (err) {
		const isValidationError = err instanceof SyntaxError
		const logLevel = isValidationError ? 'debug' : 'error'
		logger[logLevel]({ error: String(err) }, 'Failed to parse pins request')
		res.writeHead(400, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Invalid request body' }))
	}
	return true
}
