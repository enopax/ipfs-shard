import http from 'http'
import type { Blockstore } from 'interface-blockstore'
import type { IPFSNode } from '@/ipfs-node.js'
import { handleUi } from './ui.js'
import { handleMetrics } from './metrics.js'
import { handleHealth } from './health.js'
import { handlePeers } from './peers.js'
import { handleConnections } from './connections.js'
import { handlePins } from './pins.js'
import { handleBlocks } from './blocks.js'
import { handleDht } from './dht.js'
import { handleStats } from './stats.js'

export interface RouteContext {
	node: IPFSNode
	blockstore: Blockstore
	version: string
	checkS3Health?: () => Promise<boolean>
}

export async function createApiRouter(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse
): Promise<boolean> {
	const method = req.method || ''
	const url = req.url || '/'

	// Strip query string for route matching
	const urlWithoutQuery = url.split('?')[0]

	// Route matching
	if (method === 'GET' && urlWithoutQuery === '/') {
		return await handleUi(ctx, req, res)
	}

	if (method === 'GET' && urlWithoutQuery === '/metrics') {
		return await handleMetrics(ctx, req, res)
	}

	if (method === 'GET' && urlWithoutQuery === '/health') {
		return await handleHealth(ctx, req, res)
	}

	if (method === 'GET' && urlWithoutQuery === '/peers') {
		return await handlePeers(ctx, req, res, 'list')
	}

	if (method === 'GET' && urlWithoutQuery === '/peers/detailed') {
		return await handlePeers(ctx, req, res, 'detailed')
	}

	if (method === 'GET' && urlWithoutQuery.startsWith('/peers/detailed/')) {
		return await handlePeers(ctx, req, res, 'detailed-single')
	}

	if (method === 'GET' && urlWithoutQuery === '/connections') {
		return await handleConnections(ctx, req, res, 'list')
	}

	if (method === 'POST' && urlWithoutQuery === '/connect') {
		return await handleConnections(ctx, req, res, 'connect')
	}

	if (method === 'POST' && urlWithoutQuery === '/ping') {
		return await handleConnections(ctx, req, res, 'ping')
	}

	if (method === 'GET' && urlWithoutQuery === '/pins') {
		return await handlePins(ctx, req, res, 'list')
	}

	if (method === 'POST' && urlWithoutQuery === '/pin') {
		return await handlePins(ctx, req, res, 'add')
	}

	if (method === 'DELETE' && urlWithoutQuery === '/pin') {
		return await handlePins(ctx, req, res, 'remove')
	}

	if (method === 'GET' && urlWithoutQuery.match(/^\/blocks\/[^/?]+$/)) {
		return await handleBlocks(ctx, req, res, 'check')
	}

	if (method === 'GET' && urlWithoutQuery.match(/^\/cat\/[^/?]+$/)) {
		return await handleBlocks(ctx, req, res, 'cat')
	}

	if (method === 'GET' && urlWithoutQuery.match(/^\/ls\/[^/?]+$/)) {
		return await handleBlocks(ctx, req, res, 'ls')
	}

	if (method === 'GET' && urlWithoutQuery.match(/^\/providers\/[^/?]+$/)) {
		return await handleDht(ctx, req, res, 'providers-get')
	}

	if (method === 'POST' && urlWithoutQuery === '/announce') {
		return await handleDht(ctx, req, res, 'announce')
	}

	if (method === 'GET' && urlWithoutQuery.match(/^\/dht\/status\/[^/?]+$/)) {
		return await handleDht(ctx, req, res, 'status')
	}

	if (method === 'POST' && urlWithoutQuery.match(/^\/providers\/?$/)) {
		return await handleDht(ctx, req, res, 'providers-post')
	}

	if (method === 'GET' && urlWithoutQuery === '/stats') {
		return await handleStats(ctx, req, res, 'stats')
	}

	if (method === 'POST' && urlWithoutQuery.startsWith('/dag/stat')) {
		return await handleStats(ctx, req, res, 'dag-stat')
	}

	if (method === 'POST' && urlWithoutQuery.startsWith('/block/stat')) {
		return await handleStats(ctx, req, res, 'block-stat')
	}

	// No route matched
	return false
}
