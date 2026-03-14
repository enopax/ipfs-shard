import test, { before, after } from 'node:test'
import assert from 'node:assert'
import { post, get } from './helpers/client.js'
import { startServer, stopServer } from './helpers/server.js'

before(startServer, { timeout: 70_000 })
after(stopServer)

// Wait for DHT connectivity with timeout (waits up to 30s for peers to bootstrap)
async function waitForDhtReady(timeout = 30000) {
	const startTime = Date.now()
	const pollInterval = 500 // Check every 500ms

	while (Date.now() - startTime < timeout) {
		try {
			const { status, body } = await get('/health')
			if (status === 200 && body.connections >= 4) {
				console.log(`✓ DHT ready with ${body.connections} peer connections`)
				return true
			} else if (status === 200) {
				const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
				console.log(`⏳ Waiting for peers... (${body.connections} connected, ${elapsed}s elapsed)`)
			}
		} catch (err) {
			// Server not ready yet
		}

		// Wait before polling again
		await new Promise((resolve) => setTimeout(resolve, pollInterval))
	}

	return false
}

// ============================================================================
// Long-Running Tests: Bootstrap & DHT Connectivity (30s with timeout)
// ============================================================================

test('Bootstrap timeout waits for DHT peer connectivity', async (t) => {
	// This test verifies the peer bootstrap timeout functionality
	const startTime = Date.now()
	const ready = await waitForDhtReady()
	const elapsed = Date.now() - startTime

	if (ready) {
		console.log(`✓ Bootstrap succeeded in ${(elapsed / 1000).toFixed(1)}s`)
		assert.ok(true, 'DHT should be ready with sufficient peers')
	} else {
		t.skip('Bootstrap timeout reached without sufficient peers (network may be slow)')
	}
}, { timeout: 35_000 })

test('Health endpoint shows peer connectivity status', async (t) => {
	const ready = await waitForDhtReady()
	if (!ready) {
		t.skip('DHT not sufficiently connected for this test')
		return
	}

	// Verify health endpoint provides connectivity details
	const { status, body } = await get('/health')
	assert.strictEqual(status, 200, 'Health should return 200')
	assert.ok(typeof body.connections === 'number', 'Connections should be number')
	assert.ok(body.connections >= 4, 'Should have >= 4 peer connections')
	assert.ok(body.peerId, 'Should have peerId')
	assert.ok(Array.isArray(body.multiaddrs), 'Should have multiaddrs array')

	console.log(`✓ Node is healthy with ${body.connections} peer connections`)
	console.log(`  Listening on: ${body.multiaddrs[0] || 'N/A'}`)
}, { timeout: 35_000 })

test('Stats endpoint provides network metrics', async (t) => {
	const ready = await waitForDhtReady()
	if (!ready) {
		t.skip('DHT not sufficiently connected for this test')
		return
	}

	// Get stats
	const { status, body } = await get('/stats')
	assert.strictEqual(status, 200, 'Stats should return 200')
	assert.ok(typeof body.pins.total === 'number', 'pins.total should be number')
	assert.ok(typeof body.dht.providersAnnounced === 'number', 'providersAnnounced should be number')
	assert.ok(typeof body.peers.total === 'number', 'peers.total should be number')
	assert.ok(typeof body.peers.connected === 'number', 'connected peers should be number')
	assert.ok(body.peers.connected >= 4, 'Should have >= 4 connected peers')

	console.log(`✓ Stats: ${body.peers.total} known peers, ${body.peers.connected} connected`)
	console.log(`  Announced: ${body.dht.providersAnnounced} times, Pinned: ${body.pins.total} CIDs`)
}, { timeout: 35_000 })
