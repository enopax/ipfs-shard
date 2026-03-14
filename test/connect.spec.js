import test, { before, after } from 'node:test'
import assert from 'node:assert'
import { createTestServer, closeTestServer } from './helpers/in-process-server.js'
import { createClient } from './helpers/client.js'

/**
 * Test suite for peer connection management (/connect endpoint).
 *
 * Architecture: Simplified helia-101 baseline pattern
 * - TCP transport only (no WebSockets, no QUIC)
 * - Bootstrap service for peer discovery (no active dialing)
 * - No DHT server mode or delegated routing
 * - No guaranteed peer connectivity in isolated test environments
 *
 * Test strategy:
 * - Validation tests (400/503 responses) work reliably in isolation
 * - Connectivity tests (successful dials) skipped by default (no bootstrap peers in CI)
 * - Focus: API correctness, error handling, input validation
 */

let server, get, post

before(async () => {
	const result = await createTestServer()
	server = result.server
	;({ get, post } = createClient(result.baseUrl))
})
after(() => closeTestServer(server))

test('POST /connect with missing peer field returns 400', async () => {
	const { status, body } = await post('/connect', {})

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Missing or invalid peer field')
})

test('POST /connect with non-string peer returns 400', async () => {
	const { status, body } = await post('/connect', { peer: 42 })

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Missing or invalid peer field')
})

test('POST /connect with null peer returns 400', async () => {
	const { status, body } = await post('/connect', { peer: null })

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Missing or invalid peer field')
})

test('POST /connect with empty peer string returns 400', async () => {
	const { status, body } = await post('/connect', { peer: '' })

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Missing or invalid peer field')
})

test('POST /connect with invalid multiaddr returns 400', async () => {
	const { status, body } = await post('/connect', { peer: 'not-a-multiaddr' })

	assert.strictEqual(status, 400)
	assert.ok(body.error.includes('Invalid multiaddr'), 'Error should mention invalid multiaddr')
})

test('POST /connect with malformed multiaddr returns 400', async () => {
	const { status, body } = await post('/connect', { peer: '/invalid/multiaddr/structure' })

	assert.strictEqual(status, 400)
	assert.ok(body.error.includes('Invalid multiaddr'), 'Error should mention invalid multiaddr')
})

test('POST /connect with unreachable peer returns 503', async () => {
	// TEST-only peer address: 192.0.2.0/24 is IANA reserved for documentation/examples
	const { status, body } = await post('/connect', {
		peer: '/ip4/192.0.2.1/tcp/4001/p2p/12D3KooWH8A2dNgr1tKEGfAZmj7ynDezMmFQy1pn8RRF3DYS9HFY',
	})

	assert.strictEqual(status, 503)
	assert.strictEqual(body.error, 'Failed to connect to peer')
}, { timeout: 10_000 })

test('POST /connect with localhost peer fails gracefully', async () => {
	// Attempt to dial self (localhost) with fake peer ID - should fail with 503
	const { status, body } = await post('/connect', {
		peer: '/ip4/127.0.0.1/tcp/5555/p2p/12D3KooWH8A2dNgr1tKEGfAZmj7ynDezMmFQy1pn8RRF3DYS9HFY',
	})

	// Either 503 (connection refused) or 400 (bad peer ID format) are acceptable
	assert.ok([400, 503].includes(status), `Expected 400 or 503, got ${status}`)
}, { timeout: 10_000 })

test('POST /connect with BOOTSTRAP_PEERS dials known peers (optional)', async (t) => {
	// Skip by default - only runs in environments with configured BOOTSTRAP_PEERS
	const bootstrapPeersEnv = process.env.BOOTSTRAP_PEERS || ''
	const bootstrapPeers = bootstrapPeersEnv.split(',').map((p) => p.trim()).filter((p) => p.length > 0)

	if (bootstrapPeers.length === 0) {
		t.skip('No BOOTSTRAP_PEERS configured - skipping connectivity test')
		return
	}

	// Try to connect to the first configured bootstrap peer
	const peerAddr = bootstrapPeers[0]
	const { status, body } = await post('/connect', { peer: peerAddr })

	// Success (200) or connection timeout (503) are both valid outcomes
	// - 200 = successfully dialed and connected
	// - 503 = peer unreachable (network, firewall, peer offline, etc.)
	assert.ok([200, 503].includes(status), `Expected 200 or 503, got ${status}`)
}, { timeout: 15_000 })

test('POST /connect response includes peer field on success', async (t) => {
	// Skip by default - requires reachable bootstrap peers
	const bootstrapPeersEnv = process.env.BOOTSTRAP_PEERS || ''
	const bootstrapPeers = bootstrapPeersEnv.split(',').map((p) => p.trim()).filter((p) => p.length > 0)

	if (bootstrapPeers.length === 0) {
		t.skip('No BOOTSTRAP_PEERS configured - skipping connectivity test')
		return
	}

	const peerAddr = bootstrapPeers[0]
	const { status, body } = await post('/connect', { peer: peerAddr })

	// If connection succeeded (200), response should include 'ok' and 'peer' fields
	if (status === 200) {
		assert.strictEqual(body.ok, true)
		assert.strictEqual(body.peer, peerAddr)
	}
}, { timeout: 15_000 })

test('Health endpoint reports peer connection status', async () => {
	const { status, body } = await get('/health')

	assert.strictEqual(status, 200)
	assert.ok(typeof body.connections === 'number', 'connections should be a number')
	assert.ok(body.connections >= 0, 'connections should be non-negative')
	assert.ok(body.peerId, 'peerId should be present')
	assert.ok(Array.isArray(body.multiaddrs), 'multiaddrs should be an array')
	// In isolated environments: connections may be 0 (no bootstrap peers)
	// In connected environments: connections > 0 (at least 1 bootstrap peer)
})
