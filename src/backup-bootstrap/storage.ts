import type { Datastore } from 'interface-datastore'
import { Key } from 'interface-datastore'
import { multiaddr } from '@multiformats/multiaddr'
import type { Multiaddr } from '@multiformats/multiaddr'
import { logger } from '../logger.js'

const BACKUP_PEERS_KEY = new Key('/local/temp_bootstrap_peers')

/**
 * Load backup bootstrap peers from datastore.
 * Returns empty array if key not found.
 */
export async function loadBackupPeers(datastore: Datastore): Promise<Multiaddr[]> {
	try {
		const data = await datastore.get(BACKUP_PEERS_KEY)
		const json: string[] = JSON.parse(new TextDecoder().decode(data))
		return json.map((addr) => multiaddr(addr))
	} catch (err: any) {
		// Handle NotFoundError when key doesn't exist yet
		if (err.name === 'NotFoundError' || err.code === 'ERR_NOT_FOUND') {
			return []
		}
		logger.warn({ error: String(err) }, 'Failed to load backup peers from datastore')
		return []
	}
}

/**
 * Save backup bootstrap peers to datastore as JSON.
 */
export async function saveBackupPeers(datastore: Datastore, peers: Multiaddr[]): Promise<void> {
	try {
		const json = peers.map((p) => p.toString())
		const data = new TextEncoder().encode(JSON.stringify(json))
		await datastore.put(BACKUP_PEERS_KEY, data)
		logger.debug(
			{ count: peers.length, key: BACKUP_PEERS_KEY.toString() },
			'Backup peers saved to datastore'
		)
	} catch (err) {
		logger.warn({ error: String(err) }, 'Failed to save backup peers to datastore')
	}
}
