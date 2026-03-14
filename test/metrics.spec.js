import test, { before, after } from 'node:test'
import assert from 'node:assert'
import { createTestServer, closeTestServer } from './helpers/in-process-server.js'
import { createClient } from './helpers/client.js'

let server, getRaw

before(async () => {
	const result = await createTestServer()
	server = result.server
	;({ getRaw } = createClient(result.baseUrl))
})
after(() => closeTestServer(server))

test('GET /metrics returns 200 with Prometheus text format', async () => {
	const { status, text } = await getRaw('/metrics')

	assert.strictEqual(status, 200)
	assert.ok(text.length > 0)
	assert.ok(text.startsWith('#'), 'Prometheus format should start with #')
})

test('GET /metrics body contains required IPFS metrics', async () => {
	const { status, text } = await getRaw('/metrics')

	assert.strictEqual(status, 200)

	const requiredMetrics = [
		'ipfs_connected_peers',
		'ipfs_connections',
		'ipfs_uptime_seconds',
		'ipfs_node_info',
	]

	for (const metric of requiredMetrics) {
		assert.ok(text.includes(metric), `Missing metric: ${metric}`)
	}
})

test('GET /metrics contains Node.js default metrics', async () => {
	const { status, text } = await getRaw('/metrics')

	assert.strictEqual(status, 200)
	assert.ok(text.includes('process_cpu_seconds_total'), 'Missing Node.js metric: process_cpu_seconds_total')
})

test('GET /metrics ipfs_uptime_seconds is a valid number', async () => {
	const { status, text } = await getRaw('/metrics')

	assert.strictEqual(status, 200)

	const match = text.match(/^ipfs_uptime_seconds (\d+)/m)
	assert.ok(match, 'ipfs_uptime_seconds not found in metrics')

	const uptime = parseInt(match[1], 10)
	assert.ok(!Number.isNaN(uptime), 'ipfs_uptime_seconds is not a valid number')
	assert.ok(uptime >= 0, 'ipfs_uptime_seconds should be non-negative')
})
