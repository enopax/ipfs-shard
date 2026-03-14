/**
 * Mock IPFSNode for in-process testing.
 * All async generators return empty; all side-effecting methods are no-ops.
 * Override properties via the `overrides` argument.
 */
export function createMockNode(overrides = {}) {
	return {
		libp2p: {
			peerId: { toString: () => '12D3KooWTestPeerIdForInProcessTests' },
			getConnections: () => [],
			getMultiaddrs: () => [],
			getPeers: () => [],
			peerStore: { all: async () => [] },
			dial: async (_ma) => {
				throw new Error('dial not available in mock')
			},
			services: {
				ping: {
					ping: async (_ma) => {
						throw new Error('ping not available in mock')
					},
				},
			},
		},
		routing: {
			provide: async (_cid) => {},
			findProviders: async function* (_cid, _opts) {},
		},
		pins: {
			add: async (_cid) => {},
			rm: async (_cid) => {},
			ls: async function* () {},
		},
		dht: {
			getStatus: async (_cid) => null,
			setStatus: async (_cid, _record) => {},
		},
		isPinned: async (_cid) => false,
		...overrides,
	}
}

/**
 * Create a stateful pins mock that tracks pinned CIDs in an in-memory Set.
 * Used for tests that need to verify pinning operations (e.g., dht-promote.spec.js).
 */
export function createStatefulPinsMock() {
	const pinnedCids = new Set()

	return {
		add: async (cid) => {
			pinnedCids.add(cid.toString())
		},
		rm: async (cid) => {
			pinnedCids.delete(cid.toString())
		},
		ls: async function* () {
			for (const cidStr of pinnedCids) {
				yield { cid: { toString: () => cidStr } }
			}
		},
	}
}
