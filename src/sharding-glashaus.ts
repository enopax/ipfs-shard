/**
 * Sharding strategy that matches Glashaus S3 blockstore key format
 * Key format: blocks/{cid}
 * This ensures the shard can access blocks uploaded by Glashaus
 */

import { CID } from 'multiformats/cid'
import type { ShardingStrategy } from 'blockstore-s3'

export class GlashausShardingStrategy implements ShardingStrategy {
	public extension = ''

	encode(cid: CID): string {
		return `blocks/${cid.toString()}`
	}

	decode(path: string): CID {
		const cidStr = path.replace(/^blocks\//, '')
		return CID.parse(cidStr)
	}
}
