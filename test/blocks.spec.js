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

test('GET /blocks/:cid returns 400 for invalid CID string', async () => {
	const { status, body } = await get('/blocks/not-a-cid')

	assert.strictEqual(status, 400)
	assert.ok(body.error)
	assert.strictEqual(body.error, 'Invalid CID')
})

test('GET /blocks/:cid returns 200 for valid CIDv1 with exists boolean', async () => {
	const { status, body } = await get('/blocks/bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')

	assert.strictEqual(status, 200)
	assert.strictEqual(body.cid, 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')
	assert.ok(typeof body.exists === 'boolean')
})

test('GET /blocks/:cid returns 200 for valid CIDv0 with exists boolean', async () => {
	const { status, body } = await get('/blocks/QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx')

	assert.strictEqual(status, 200)
	assert.strictEqual(body.cid, 'QmZ4tDuvesekSs4qM5ZBKpXiZGun7S2CYtEZRB3DYXkjGx')
	assert.ok(typeof body.exists === 'boolean')
})
