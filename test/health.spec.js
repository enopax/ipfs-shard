import test, { before, after } from 'node:test'
import assert from 'node:assert'
import { createTestServer, closeTestServer } from './helpers/in-process-server.js'
import { createClient } from './helpers/client.js'

let server, get

before(async () => {
	const result = await createTestServer()
	server = result.server
	;({ get } = createClient(result.baseUrl))
})
after(() => closeTestServer(server))

test('GET /health returns 200 with required fields', async () => {
	const { status, body } = await get('/health')

	assert.strictEqual(status, 200)
	assert.ok(typeof body.peerId === 'string')
	assert.ok(body.peerId.length > 0)
	assert.ok(typeof body.connections === 'number')
	assert.ok(body.connections >= 0)
	assert.strictEqual(body.dhtMode, 'server')
	assert.ok(typeof body.uptime === 'number')
	assert.ok(body.uptime >= 0)
	assert.ok(Array.isArray(body.multiaddrs))
})
