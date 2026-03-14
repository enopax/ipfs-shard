import http from 'http'
import { URL } from 'url'

/**
 * Normalize path for metrics to collapse dynamic CID segments.
 * /providers/Qm... → /providers/:cid
 * /blocks/Qm... → /blocks/:cid
 */
export function normalisePath(path: string): string {
	return path
		.replace(/^\/providers\/[^/?]+/, '/providers/:cid')
		.replace(/^\/blocks\/[^/?]+/, '/blocks/:cid')
		.replace(/^\/dht\/status\/[^/?]+/, '/dht/status/:cid')
		.replace(/^\/cat\/[^/?]+/, '/cat/:cid')
		.replace(/^\/ls\/[^/?]+/, '/ls/:cid')
}

export function parseJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
	return new Promise((resolve, reject) => {
		let body = ''
		req.on('data', (chunk) => {
			body += chunk.toString()
		})
		req.on('end', () => {
			try {
				resolve(JSON.parse(body))
			} catch (err) {
				reject(err)
			}
		})
		req.on('error', reject)
	})
}

export function getClientIp(req: http.IncomingMessage): string {
	const forwarded = req.headers['x-forwarded-for']
	if (typeof forwarded === 'string') {
		return forwarded.split(',')[0].trim()
	}
	return req.socket?.remoteAddress || 'unknown'
}

export function getQueryParam(urlStr: string, paramName: string): string | null {
	try {
		const url = new URL(urlStr, 'http://localhost')
		return url.searchParams.get(paramName)
	} catch {
		return null
	}
}
