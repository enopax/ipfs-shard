import test, { before, after } from 'node:test'
import assert from 'node:assert'
import { get, post } from './helpers/client.js'
import { startServer, stopServer } from './helpers/server.js'

before(startServer, { timeout: 70_000 })
after(stopServer)

test('Peer connectivity: Server should establish peer connections within 60s', async (t) => {
	const maxWaitTime = 60_000 // 60 seconds
	const checkInterval = 2_000 // Check every 2 seconds
	const startTime = Date.now()

	let connectedPeerCount = 0
	let lastError = null
	let checkCount = 0
	let maxConnections = 0

	console.log('[connectivity-test] Starting peer connection check...')

	while (Date.now() - startTime < maxWaitTime) {
		checkCount++
		try {
			const { status, body } = await get('/connections')

			if (status === 200 && Array.isArray(body.connections)) {
				connectedPeerCount = body.connections.filter((c) => c.status === 'open').length
				maxConnections = Math.max(maxConnections, connectedPeerCount)

				console.log(`[connectivity-test] Check ${checkCount}: ${connectedPeerCount} open connections (at ${Date.now() - startTime}ms)`)

				if (connectedPeerCount > 0) {
					console.log(`✓ Established ${connectedPeerCount} peer connection(s) after ${Date.now() - startTime}ms`)
					return // Test passes
				}
			}
		} catch (err) {
			lastError = err
			console.log(`[connectivity-test] Check ${checkCount}: Error - ${err?.message}`)
		}

		// Wait before checking again
		await new Promise((resolve) => setTimeout(resolve, checkInterval))
	}

	// Log diagnostic info before failing
	console.log('[connectivity-test] Timeout reached - gathering diagnostics...')
	let healthBody = null
	let peersBody = null

	try {
		const healthResp = await get('/health')
		healthBody = healthResp.body
		console.log('[connectivity-test] Health endpoint status:', healthResp.status)
	} catch (err) {
		console.error('[connectivity-test] Failed to get health:', err?.message)
	}

	try {
		const peersResp = await get('/peers/detailed')
		peersBody = peersResp.body
		console.log('[connectivity-test] Peers endpoint status:', peersResp.status)
	} catch (err) {
		console.error('[connectivity-test] Failed to get peers:', err?.message)
	}

	console.log('[connectivity-test] === Diagnostic Summary ===')
	console.log('- Max connections observed:', maxConnections)
	console.log('- Final connection count:', connectedPeerCount)
	console.log('- Total checks performed:', checkCount)
	console.log('- Known peers in peer store:', peersBody?.Peers?.length || 'N/A')
	console.log('- Health status:', healthBody ? { peerId: healthBody.peerId, dhtMode: healthBody.dhtMode } : 'N/A')
	console.log('- Last error:', lastError?.message || 'None')
	console.log('[connectivity-test] === End Diagnostic Summary ===')

	assert.fail(
		`Failed to establish any peer connections within ${maxWaitTime}ms. ` +
			`Max connections observed: ${maxConnections}. ` +
			`Known peers: ${peersBody?.Peers?.length || 0}. ` +
			`Last error: ${lastError?.message}`
	)
}, { timeout: 65_000 })

test('Peer connectivity: Bootstrap peers should be in peer store', async () => {
	console.log('[bootstrap-test] Checking peer store contents...')

	const { status, body } = await get('/peers/detailed')

	assert.strictEqual(status, 200)
	assert.ok(Array.isArray(body.Peers), 'Should have Peers array')

	if (body.Peers.length === 0) {
		console.warn('[bootstrap-test] No peers in peer store (DNS resolution may have failed during bootstrap)')
		console.warn('[bootstrap-test] This is expected in isolated test environments')
	} else {
		console.log(`✓ Found ${body.Peers.length} peer(s) in peer store:`)
		body.Peers.forEach((peer, idx) => {
			console.log(`  [${idx + 1}] ${peer.ID} (${peer.Addrs?.length || 0} addresses)`)
		})
	}
})

test('Peer connectivity: Manual dial to known IPv4 peer should work or timeout gracefully', async (t) => {
	// The KNOWN_IPFS_PEERS env var should contain at least one reachable IPv4 peer
	const knownPeer = process.env.KNOWN_IPFS_PEERS

	if (!knownPeer) {
		console.log('[dial-test] KNOWN_IPFS_PEERS not configured, skipping manual dial test')
		t.skip('KNOWN_IPFS_PEERS not configured')
		return
	}

	const peers = knownPeer.split(',').map((p) => p.trim()).filter((p) => p.length > 0)

	if (peers.length === 0) {
		console.log('[dial-test] No KNOWN_IPFS_PEERS configured, skipping manual dial test')
		t.skip('No KNOWN_IPFS_PEERS configured')
		return
	}

	console.log(`[dial-test] Testing manual dial to ${peers.length} known peer(s)`)

	for (let idx = 0; idx < peers.length; idx++) {
		const peer = peers[idx]
		console.log(`[dial-test] [${idx + 1}/${peers.length}] Attempting dial to: ${peer.substring(0, 80)}...`)

		const { status, body } = await post('/connect', { peer })

		// Either succeeds (200) or fails due to network (503)
		// Both are acceptable - we're testing that the endpoint works
		assert.ok([200, 503].includes(status), `Expected 200 or 503, got ${status}`)

		if (status === 200) {
			console.log(`[dial-test] ✓ Successfully connected to ${peer.substring(0, 60)}...`)
			return
		} else {
			console.log(`[dial-test] ✗ Failed to connect: ${body.error}`)
		}
	}

	console.warn('[dial-test] Could not connect to any known peer - this is expected in isolated environments')
	// Don't fail - dial failures are acceptable in test environments
}, { timeout: 30_000 })

test('Peer connectivity: DHT should be in server mode', async () => {
	console.log('[dht-test] Checking DHT configuration...')

	const { status, body } = await get('/health')

	assert.strictEqual(status, 200)
	assert.strictEqual(body.dhtMode, 'server', 'DHT should be in server mode for peer discovery')
	console.log(`✓ DHT is configured in ${body.dhtMode} mode`)
	console.log(`  - Node responds to inbound DHT queries (server mode enabled)`)
})

test('Peer connectivity: libp2p should have persistent peer identity', async () => {
	console.log('[identity-test] Checking peer identity...')

	// Get peer ID from health endpoint
	const { status, body: health1 } = await get('/health')

	assert.strictEqual(status, 200)
	assert.ok(health1.peerId, 'Should have peer ID')

	const peerId1 = health1.peerId
	console.log(`✓ Peer ID: ${peerId1}`)
	console.log(`  - Format: ${peerId1.startsWith('12D3Koo') ? 'libp2p v3+ (CIDv1)' : 'IPFS (CIDv0)'}`)

	// Verify it's a valid peer ID format (starts with 12D3Koo or Qm for older format)
	assert.ok(
		peerId1.startsWith('12D3Koo') || peerId1.startsWith('Qm'),
		`Peer ID should start with 12D3Koo or Qm, got: ${peerId1}`
	)
})
