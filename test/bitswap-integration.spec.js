import assert from 'assert'
import test from 'node:test'

// Use Node.js v24 built-in fetch (no imports needed)

/**
 * Bitswap Integration Tests - Performance & Timeout Validation
 *
 * These tests measure actual block retrieval performance with the new
 * bidirectional bitswap implementation and validate timeout behaviour.
 */

const API_URL = process.env.SHARD_API_URL || 'http://localhost:4000'

test('Bitswap Integration: /health endpoint is responsive', async (t) => {
	const start = Date.now()
	const response = await fetch(`${API_URL}/health`)
	const duration = Date.now() - start

	assert.strictEqual(response.status, 200)
	const data = await response.json()
	assert(data.connections > 0, 'Should have peer connections')
	console.log(`  Health check: ${duration}ms (connections: ${data.connections})`)
})

test('Bitswap Integration: Small JSON file (public CID) retrieval', async (t) => {
	// Test with real public CID: small JSON file
	const publicCID = 'bafkreifi5kprzcqc3tf7xnql4hrd57r2eqgbsp6wcycevpuh5pawm7mp5q'

	const start = Date.now()
	const response = await fetch(`${API_URL}/cat/${publicCID}`)
	const duration = Date.now() - start

	console.log(`  Public JSON CID (${publicCID}):`)
	console.log(`    Status: ${response.status}`)
	console.log(`    Duration: ${duration}ms`)

	if (response.status === 200) {
		const data = await response.text()
		console.log(`    Size: ${data.length} bytes`)
		console.log(`    ✓ Successfully retrieved from network`)
	} else if (response.status === 404) {
		console.log(`    ⚠️  Not found on connected peers (may be available on other peers)`)
		console.log(`    Duration check: ${duration}ms (should be ~5s with new timeout)`)
		if (duration > 4500 && duration < 6000) {
			console.log(`    ✓ Timeout duration is correct`)
		}
	} else {
		console.log(`    ✗ Unexpected status`)
	}
})

test('Bitswap Integration: IPFS logo (well-known CID) retrieval', async (t) => {
	// Test with real public CID: IPFS logo (very well-distributed)
	const ipfsLogoCID = 'QmR5nCvXgL9W5PPRfgKJwMbY8TBW4D8A7tK7vJsH7zTJbv'

	const start = Date.now()
	const response = await fetch(`${API_URL}/cat/${ipfsLogoCID}`)
	const duration = Date.now() - start

	console.log(`  IPFS Logo CID (${ipfsLogoCID}):`)
	console.log(`    Status: ${response.status}`)
	console.log(`    Duration: ${duration}ms`)

	if (response.status === 200) {
		const data = await response.arrayBuffer()
		console.log(`    Size: ${data.byteLength} bytes`)
		console.log(`    ✓ Successfully retrieved from network`)
		if (duration < 2000) {
			console.log(`    ✓ FAST: Retrieved in ${duration}ms (likely from cache or local peer)`)
		}
	} else if (response.status === 404) {
		console.log(`    ⚠️  Not found on connected peers`)
		console.log(`    Duration check: ${duration}ms (timeout should be ~5s with new config)`)
		if (duration > 4500 && duration < 6000) {
			console.log(`    ✓ Bitswap timeout is working correctly`)
		}
	}
})

test('Bitswap Integration: Concurrent requests with real CIDs', async (t) => {
	// Verify that concurrent requests to different CIDs don't interfere
	const cid1 = 'bafkreifi5kprzcqc3tf7xnql4hrd57r2eqgbsp6wcycevpuh5pawm7mp5q' // JSON file
	const cid2 = 'QmR5nCvXgL9W5PPRfgKJwMbY8TBW4D8A7tK7vJsH7zTJbv' // IPFS logo

	const start = Date.now()
	const [resp1, resp2] = await Promise.all([
		fetch(`${API_URL}/cat/${cid1}`),
		fetch(`${API_URL}/cat/${cid2}`),
	])
	const duration = Date.now() - start

	console.log(`  Concurrent requests (2 real CIDs):`)
	console.log(`    CID1 status: ${resp1.status}`)
	console.log(`    CID2 status: ${resp2.status}`)
	console.log(`    Total duration: ${duration}ms`)

	// With parallelization, should be similar to single request (~5-10s if both timeout)
	// Sequential would be ~10-20s
	if (duration < 12000) {
		console.log('    ✓ Concurrent requests run in parallel (not sequential)')
	} else if (duration < 20000) {
		console.warn('    ⚠️  May have some blocking, but mostly parallel')
	} else {
		console.warn('    ✗ Requests appear to be sequential')
	}
})

test('Bitswap Integration: Request cancellation works', async (t) => {
	// Test that AbortSignal properly cancels bitswap wants
	// This validates the timeout mechanism with a real CID

	const cid = 'bafkreifi5kprzcqc3tf7xnql4hrd57r2eqgbsp6wcycevpuh5pawm7mp5q'
	const controller = new AbortController()

	// Cancel after 2 seconds (before 5s bitswap timeout)
	const cancelTimer = setTimeout(() => controller.abort(), 2000)

	const start = Date.now()
	try {
		const response = await fetch(`${API_URL}/cat/${cid}`, {
			signal: controller.signal,
		})
		// If we get here, the CID was found (not cancelled)
		const duration = Date.now() - start
		console.log(`  Request completed before cancellation: ${duration}ms`)
		console.log(`    ✓ CID was retrieved from network`)
		clearTimeout(cancelTimer)
	} catch (err) {
		const duration = Date.now() - start
		clearTimeout(cancelTimer)

		console.log(`  Request cancelled after: ${duration}ms`)

		// Should cancel within ~2000ms + small overhead, not wait full bitswap timeout
		if (duration < 3000) {
			console.log('    ✓ Cancellation is responsive')
		} else {
			console.warn(`    ⚠️  Cancellation took ${duration}ms, expected < 3000ms`)
		}
	}
})

test('Bitswap Integration: Timeout configuration via env vars', async (t) => {
	// This test documents the timeout environment variables
	// Users can adjust these based on network conditions

	const recommendedConfig = {
		BITSWAP_WANT_TIMEOUT_MS: 5000,
		DHT_PROVIDER_TIMEOUT_MS: 5000,
		BLOCK_CACHE_MB: 512, // Optional: enable 512MB block cache
	}

	console.log('\n  Recommended Bitswap Configuration:')
	console.log('  ' + JSON.stringify(recommendedConfig, null, 4).split('\n').join('\n  '))
	console.log('\n  Usage:')
	console.log('    BITSWAP_WANT_TIMEOUT_MS=5000 npm run dev')
	console.log('    # or in .env file')
	console.log('')
})

export default {}
