import http from 'http'
import { CID } from 'multiformats'
import { logger } from '@/logger.js'
import { dhtLastAnnounceGauge } from '@/metrics.js'
import { parseJsonBody, getQueryParam } from './helpers.js'
import type { RouteContext } from './http-router.js'

const PROVIDERS_TIMEOUT_MS = parseInt(process.env.PROVIDERS_TIMEOUT_MS || '15000', 10)

// In-memory tracking for announce stats
let lastAnnouncedAt: Date | null = null
let totalProvidersAnnounced = 0

export async function announceContent(ctx: RouteContext, cid: CID, cidStr: string): Promise<void> {
	try {
		await ctx.node.dht.setStatus(cid, { status: 'pending', announcedAt: Date.now() })
	} catch (err) {
		logger.warn({ cid: cidStr }, 'Failed to write pending DHT status')
	}

	ctx.node.routing.provide(cid).then(
		async () => {
			await ctx.node.dht.setStatus(cid, { status: 'success', announcedAt: Date.now() })
			logger.info({ cid: cidStr }, 'Content announced to DHT')
		},
		async (err: unknown) => {
			await ctx.node.dht.setStatus(cid, {
				status: 'failed',
				announcedAt: Date.now(),
				error: String(err),
			})
			logger.warn({ cid: cidStr, error: String(err) }, 'Content announcement failed')
		}
	)
}

export async function handleDht(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse,
	action: 'providers-get' | 'providers-post' | 'announce' | 'status'
): Promise<boolean> {
	try {
		if (action === 'announce') {
			const body = await parseJsonBody(req)
			const cidStr = body.cid as any

			if (!cidStr || typeof cidStr !== 'string') {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Missing or invalid cid field' }))
				return true
			}

			try {
				const cid = CID.parse(cidStr)
				await announceContent(ctx, cid, cidStr)
				lastAnnouncedAt = new Date()
				totalProvidersAnnounced++

				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true }))
			} catch (err) {
				logger.error({ cid: cidStr, error: String(err) }, 'Failed to announce content')
				res.writeHead(500, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Failed to announce content', details: String(err) }))
			}
		} else if (action === 'providers-get' || action === 'providers-post') {
			let cidStr: string
			if (action === 'providers-get') {
				cidStr = (req.url || '').split('/providers/')[1].split('?')[0]
			} else {
				const body = await parseJsonBody(req)
				cidStr = body.cid as string
			}

			if (!cidStr || typeof cidStr !== 'string') {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Missing or invalid cid field' }))
				return true
			}

			let cid
			try {
				cid = CID.parse(cidStr)
			} catch (err) {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid CID', details: String(err) }))
				return true
			}

			const signal = AbortSignal.timeout(PROVIDERS_TIMEOUT_MS)
			const providers: Array<{ peerId: string; addrs: string[] }> = []
			let timedOut = false

			try {
				for await (const provider of ctx.node.routing.findProviders(cid, { signal })) {
					providers.push({
						peerId: provider.id.toString(),
						addrs: provider.multiaddrs.map((m) => m.toString()),
					})
				}
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') {
					timedOut = true
				} else if ((err as any)?.name === 'GetFailedError') {
					// DHT returned "not found" — treat as empty result
				} else {
					throw err
				}
			}

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(
				JSON.stringify({
					providers,
					count: providers.length,
					timedOut,
				})
			)
		} else if (action === 'status') {
			const cidStr = (req.url || '').split('/dht/status/')[1].split('?')[0]
			let cid
			try {
				cid = CID.parse(cidStr)
			} catch (err) {
				res.writeHead(400, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ error: 'Invalid CID', details: String(err) }))
				return true
			}

			const [pinned, dhtRecord] = await Promise.all([
				ctx.node.isPinned(cid),
				ctx.node.dht.getStatus(cid),
			])

			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(
				JSON.stringify({
					cid: cidStr,
					pinned,
					announced: dhtRecord?.status === 'success',
					lastAnnouncedAt: dhtRecord ? new Date(dhtRecord.announcedAt).toISOString() : null,
					status: dhtRecord?.status ?? null,
				})
			)
		}
	} catch (err) {
		logger.error({ error: String(err) }, 'Failed to handle DHT request')
		res.writeHead(500, { 'Content-Type': 'application/json' })
		res.end(JSON.stringify({ error: 'Internal server error' }))
	}
	return true
}

export function getDhtStats() {
	return { lastAnnouncedAt, totalProvidersAnnounced }
}

export function updateDhtStats(announced: Date | null, count: number) {
	lastAnnouncedAt = announced
	totalProvidersAnnounced = count
}
