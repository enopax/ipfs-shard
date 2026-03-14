import http from 'http'
import { CID } from 'multiformats'
import { logger } from '@/logger.js'
import { blockRetrieveCounter, blockRetrieveDurationHistogram } from '@/metrics.js'
import { decodeDagPB, unixFSType } from './dag-pb.js'
import type { RouteContext } from './http-router.js'

export async function handleBlocks(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	action: 'check' | 'cat' | 'ls'
): Promise<boolean> {
	try {
		const url = req.url || '/'
		const cidStr = url.split('/')[2].split('?')[0]

		if (action === 'check') {
			let cid
			try {
				cid = CID.parse(cidStr)
			} catch (err) {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid CID', details: String(err) }))
				return true
			}

			const exists = await ctx.blockstore.has(cid)
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ cid: cidStr, exists }))
		} else if (action === 'cat') {
			let cid
			try {
				cid = CID.parse(cidStr)
			} catch (err) {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid CID', details: String(err) }))
				return true
			}

			try {
				const chunks: Uint8Array[] = []
				const t0 = Date.now()
				for await (const chunk of ctx.blockstore.get(cid)) {
					chunks.push(chunk)
				}
				const data = Buffer.concat(chunks)
				blockRetrieveCounter.inc()
				blockRetrieveDurationHistogram.observe((Date.now() - t0) / 1000)
				res.setHeader('Content-Type', 'application/octet-stream')
				res.setHeader('Content-Length', data.length)
				res.writeHead(200)
				res.end(data)
			} catch (err: any) {
				if (
					err?.code === 'ERR_NOT_FOUND' ||
					err?.name === 'NotFoundError' ||
					err?.name === 'GetFailedError' ||
					err?.message?.includes('not found') ||
					err?.message?.includes('NoSuchKey')
				) {
					res.writeHead(404, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ error: 'Block not found', cid: cidStr }))
					return true
				}
				logger.error({ err, cid: cidStr }, 'Failed to retrieve block')
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Failed to retrieve block' }))
			}
		} else if (action === 'ls') {
			let cid
			try {
				cid = CID.parse(cidStr)
			} catch (err) {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid CID' }))
				return true
			}

			try {
				const chunks: Uint8Array[] = []
				const t0 = Date.now()
				for await (const chunk of ctx.blockstore.get(cid)) {
					chunks.push(chunk)
				}
				const block = Buffer.concat(chunks)
				blockRetrieveCounter.inc()
				blockRetrieveDurationHistogram.observe((Date.now() - t0) / 1000)

				const node = decodeDagPB(block)
				const type = unixFSType(node.data)

				if (type === 1) {
					const entries = node.links.map((l) => ({
						name: l.name,
						cid: l.hash ? CID.decode(l.hash).toString() : null,
						size: l.size,
					}))
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ type: 'directory', entries }))
				} else {
					res.writeHead(200, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ type: type === 2 ? 'file' : 'unknown' }))
				}
			} catch (err: any) {
				if (
					err?.code === 'ERR_NOT_FOUND' ||
					err?.name === 'NotFoundError' ||
					err?.name === 'GetFailedError' ||
					err?.message?.includes('not found') ||
					err?.message?.includes('NoSuchKey')
				) {
					res.writeHead(404, { 'Content-Type': 'application/json' })
					res.end(JSON.stringify({ error: 'Block not found' }))
					return true
				}
				logger.error({ err, cid: cidStr }, 'Failed to decode block')
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Failed to decode block' }))
			}
		}
	} catch (err) {
		logger.error({ error: String(err) }, 'Failed to process block request')
		res.writeHead(500, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Internal server error' }))
	}
	return true
}
