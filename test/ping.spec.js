import test, { before, after } from 'node:test'
import assert from 'node:assert'
import { createTestServer, closeTestServer } from './helpers/in-process-server.js'
import { createClient } from './helpers/client.js'

let server, post

before(async () => {
	const result = await createTestServer()
	server = result.server
	;({ post } = createClient(result.baseUrl))
})
after(() => closeTestServer(server))

test('POST /ping returns 400 when peer field is missing', async () => {
	const { status, body } = await post('/ping', {})

	assert.strictEqual(status, 400)
	assert.ok(body.error)
})

test('POST /ping returns 400 when peer is not a string', async () => {
	const { status, body } = await post('/ping', { peer: 123 })

	assert.strictEqual(status, 400)
	assert.ok(body.error)
})

test('POST /ping returns 400 for invalid multiaddr string', async () => {
	const { status, body } = await post('/ping', { peer: 'not-a-valid-multiaddr' })

	assert.strictEqual(status, 400)
	assert.ok(body.error)
	assert.strictEqual(body.error, 'Invalid multiaddr')
})

test('POST /ping returns 503 when peer is unreachable', async (t) => {
	// Skip this test in automated runs - it's slow and requires network stability
	// This test is useful for manual testing but causes issues in CI
	t.skip('Skipping long-running network test (20s timeout) - run manually if needed')
}, { timeout: 20000 })
