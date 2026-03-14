import { startInternalAPI } from '../../src/internal-api.js'
import { createMockNode } from './mock-node.js'

/**
 * Simple mock blockstore for testing.
 * Implements async has() and get() methods without S3 dependency.
 */
function createMockBlockstore() {
	const blocks = new Map() // Map<cidStr, Uint8Array>

	return {
		async has(cid) {
			const cidStr = cid.toString()
			return blocks.has(cidStr)
		},
		async* get(cid) {
			const cidStr = cid.toString()
			if (!blocks.has(cidStr)) {
				throw new Error(`Block ${cidStr} not found`)
			}
			const block = blocks.get(cidStr)
			yield block
		},
		async put(cid, block) {
			const cidStr = cid.toString()
			blocks.set(cidStr, block)
		},
	}
}

/**
 * Create an in-process test server with mocked node and blockstore.
 * Returns { server, node, blockstore, baseUrl } where baseUrl points to ephemeral port.
 * Call closeTestServer(server) to clean up.
 */
export async function createTestServer(nodeOverrides = {}) {
	const node = createMockNode(nodeOverrides)
	const blockstore = createMockBlockstore()

	const server = await startInternalAPI({
		node,
		blockstore,
		port: 0, // Bind to ephemeral OS port
		version: '0.0.0-test',
		checkS3Health: async () => true,
	})

	const { port } = server.address()
	const baseUrl = `http://127.0.0.1:${port}`
	return { server, node, blockstore, baseUrl }
}

/**
 * Close a test server and wait for cleanup.
 */
export async function closeTestServer(server) {
	return new Promise((resolve, reject) =>
		server.close((err) => (err ? reject(err) : resolve()))
	)
}
