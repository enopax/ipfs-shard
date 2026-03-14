import test, { before, after } from 'node:test'
import assert from 'node:assert'
import { createTestServer, closeTestServer } from './helpers/in-process-server.js'
import { createClient } from './helpers/client.js'

let server, post, get

before(async () => {
	const result = await createTestServer()
	server = result.server
	;({ post, get } = createClient(result.baseUrl))
})
after(() => closeTestServer(server))

// Known CID for tests
const WELL_KNOWN_CIDv1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const WELL_KNOWN_CIDv0 = 'QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx'

// Check DHT connectivity before running provide tests
async function isDhtReady() {
	try {
		const { status, body } = await get('/health')
		if (status === 200 && body.connections >= 4) {
			return true
		}
	} catch (err) {
		// Assume not ready
	}
	return false
}

test('POST /announce with missing cid returns 400', async () => {
	const { status, body } = await post('/announce', {})

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Missing or invalid cid field')
})

test('POST /announce with non-string cid returns 400', async () => {
	const { status, body } = await post('/announce', { cid: 12345 })

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Missing or invalid cid field')
})

test('POST /announce with invalid cid string returns 500', async () => {
	const { status, body } = await post('/announce', { cid: 'not-a-cid' })

	assert.strictEqual(status, 500)
	assert.strictEqual(body.error, 'Failed to announce content')
})

test('POST /announce with valid CIDv1 returns 200', async (t) => {
	const ready = await isDhtReady()
	if (!ready) {
		t.skip('DHT not sufficiently connected to test provide operation')
		return
	}

	const { status, body } = await post('/announce', { cid: WELL_KNOWN_CIDv1 })

	assert.strictEqual(status, 200)
	assert.strictEqual(body.ok, true)
}, { timeout: 60_000 })

test('POST /announce with valid CIDv0 returns 200', async (t) => {
	const ready = await isDhtReady()
	if (!ready) {
		t.skip('DHT not sufficiently connected to test provide operation')
		return
	}

	const { status, body } = await post('/announce', { cid: WELL_KNOWN_CIDv0 })

	assert.strictEqual(status, 200)
	assert.strictEqual(body.ok, true)
}, { timeout: 60_000 })

test('POST /announce and GET /providers round-trip', async (t) => {
	// Skip this test in automated runs - it's slow (30s DHT timeout) and requires network stability
	// This test is useful for manual testing but causes issues in CI
	t.skip('Skipping long-running DHT round-trip test (30s+ timeout) - run manually if needed')
}, { timeout: 60_000 })

test('POST /providers with missing cid returns 400', async () => {
	const { status, body } = await post('/providers', {})

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Missing or invalid cid field')
})

test('POST /providers with invalid cid returns 400', async () => {
	const { status, body } = await post('/providers', { cid: 'not-a-cid' })

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Invalid CID')
})

test('POST /providers with valid CIDv1 returns 200', async (t) => {
	// Skip this test in automated runs - DHT queries can hang or cause connection issues
	t.skip('Skipping DHT provider query test (can hang or cause connection reset) - run manually if needed')
}, { timeout: 60_000 })
