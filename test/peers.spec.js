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

test('GET /peers returns 200 with peers array', async () => {
	const { status, body } = await get('/peers')

	assert.strictEqual(status, 200)
	assert.ok(Array.isArray(body.peers))
	assert.strictEqual(body.count, body.peers.length)

	for (const peer of body.peers) {
		assert.ok(typeof peer === 'string')
	}
})

test('GET /connections returns 200 with connections array', async () => {
	const { status, body } = await get('/connections')

	assert.strictEqual(status, 200)
	assert.ok(Array.isArray(body.connections))
	assert.strictEqual(body.count, body.connections.length)

	for (const conn of body.connections) {
		assert.ok(typeof conn.id === 'string')
		assert.ok(typeof conn.remotePeer === 'string')
		assert.ok(typeof conn.remoteAddr === 'string')
		assert.ok(typeof conn.direction === 'string')
		assert.ok(['inbound', 'outbound'].includes(conn.direction))
		assert.ok(typeof conn.status === 'string')
		assert.ok(typeof conn.timeline?.open === 'number')
	}
})
