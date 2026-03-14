import test, { before, after } from 'node:test'
import assert from 'node:assert'
import { createTestServer, closeTestServer } from './helpers/in-process-server.js'
import { createClient } from './helpers/client.js'

let server, postQuery

before(async () => {
	const result = await createTestServer()
	server = result.server
	;({ postQuery } = createClient(result.baseUrl))
})
after(() => closeTestServer(server))

// Well-known CID for tests
const WELL_KNOWN_CIDv1 = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'

test('POST /dag/stat without arg parameter returns 400', async () => {
	const { status, body } = await postQuery('/dag/stat')

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Missing or invalid arg query parameter')
})

test('POST /dag/stat with CID not in local blockstore returns 500 with graceful message', async () => {
	const { status, body } = await postQuery(`/dag/stat?arg=${WELL_KNOWN_CIDv1}`)

	assert.strictEqual(status, 500)
	assert.strictEqual(body.error, 'Failed to get DAG stat')
	assert.ok(body.details)
	assert.ok(
		body.details.includes('not found in local blockstore') || body.details.includes('Failed to get DAG stat'),
		'Error details should indicate block not found'
	)
})

test('POST /block/stat without arg parameter returns 400', async () => {
	const { status, body } = await postQuery('/block/stat')

	assert.strictEqual(status, 400)
	assert.strictEqual(body.error, 'Missing or invalid arg query parameter')
})

test('POST /block/stat with CID not in local blockstore returns 500 with graceful message', async () => {
	const { status, body } = await postQuery(`/block/stat?arg=${WELL_KNOWN_CIDv1}`)

	assert.strictEqual(status, 500)
	assert.strictEqual(body.error, 'Failed to get block stat')
	assert.ok(body.details)
	assert.ok(
		body.details.includes('not found in local blockstore') || body.details.includes('Failed to get block stat'),
		'Error details should indicate block not found'
	)
})
