import type { Multiaddr } from '@multiformats/multiaddr'

const MAX_BACKUP_PEERS = 20

/**
 * Select peers to save as backups.
 * Pure function: no side effects, no async.
 *
 * Algorithm (Kubo):
 * 1. Randomise connected peers
 * 2. Exclude any that are in officialBootstrap
 * 3. Cap at MAX_BACKUP_PEERS (20)
 * 4. Backfill from previouslySaved if under max
 * 5. Return result
 */
export function selectPeersToSave(
	connected: Multiaddr[],
	officialBootstrap: Multiaddr[],
	previouslySaved: Multiaddr[],
	max: number = MAX_BACKUP_PEERS
): Multiaddr[] {
	if (connected.length === 0) {
		return []
	}

	// Extract peer IDs from official bootstrap for comparison
	const officialPeerIds = new Set<string>()
	for (const addr of officialBootstrap) {
		const peerId = addr.getPeerId()
		if (peerId) {
			officialPeerIds.add(peerId)
		}
	}

	// Randomise connected peers
	const shuffled = [...connected].sort(() => Math.random() - 0.5)

	// Filter: exclude official bootstrap peers
	const filtered = shuffled.filter((addr) => {
		const peerId = addr.getPeerId()
		return !peerId || !officialPeerIds.has(peerId)
	})

	// Cap at max
	let result = filtered.slice(0, max)

	// Backfill from previouslySaved if needed
	if (result.length < max && previouslySaved.length > 0) {
		const previousPeerIds = new Set<string>()
		for (const addr of result) {
			const peerId = addr.getPeerId()
			if (peerId) {
				previousPeerIds.add(peerId)
			}
		}

		// Add previously saved peers that aren't already in result
		for (const addr of previouslySaved) {
			if (result.length >= max) break

			const peerId = addr.getPeerId()
			if (peerId && !previousPeerIds.has(peerId)) {
				result.push(addr)
				previousPeerIds.add(peerId)
			}
		}
	}

	return result
}
