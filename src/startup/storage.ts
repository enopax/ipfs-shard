import { S3Blockstore } from 'blockstore-s3'
import { S3Datastore } from 'datastore-s3'
import { MemoryBlockstore } from 'blockstore-core'
import { MemoryDatastore } from 'datastore-core'
import { S3Client, CreateBucketCommand, HeadBucketCommand } from '@aws-sdk/client-s3'
import type { Datastore } from 'interface-datastore'
import type { Blockstore } from 'interface-blockstore'
import { logger } from '@/logger.js'
import { GlashausShardingStrategy } from '@/sharding-glashaus.js'
import { isMemoryStorageEnabled } from './env.js'

/**
 * Create S3 client with shared configuration.
 */
export function createS3Client(): S3Client {
	const endpoint = process.env.S3_ENDPOINT
	const region = process.env.S3_REGION || 'us-east-1'

	return new S3Client({
		region,
		...(endpoint && { endpoint }),
		forcePathStyle: true,
		credentials: {
			accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
			secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
		},
	})
}

/**
 * Create and ensure S3Blockstore bucket exists.
 */
async function createS3Blockstore(s3Client: S3Client): Promise<Blockstore> {
	const bucket = process.env.S3_BUCKET!

	logger.info({ bucket }, 'Creating S3 blockstore')

	// Ensure bucket exists
	try {
		await s3Client.send(new HeadBucketCommand({ Bucket: bucket }))
		logger.info({ bucket }, 'S3 bucket exists')
	} catch (err: any) {
		if (err.name === 'NoSuchBucket') {
			logger.info({ bucket }, 'Creating S3 bucket')
			try {
				await s3Client.send(new CreateBucketCommand({ Bucket: bucket }))
				logger.info({ bucket }, 'S3 bucket created')
			} catch (createErr) {
				logger.error({ bucket, error: String(createErr) }, 'Failed to create S3 bucket')
				throw createErr
			}
		} else {
			logger.error({ bucket, error: String(err) }, 'Failed to check S3 bucket')
			throw err
		}
	}

	return new S3Blockstore(s3Client as any, bucket, {
		createIfMissing: true,
		shardingStrategy: new GlashausShardingStrategy(),
	})
}

/**
 * Create blockstore (S3 or memory).
 */
export async function createBlockstore(s3Client?: S3Client): Promise<Blockstore> {
	if (isMemoryStorageEnabled()) {
		logger.info('Creating in-memory blockstore')
		return new MemoryBlockstore()
	}

	if (!s3Client) throw new Error('S3Client required for S3Blockstore')
	return createS3Blockstore(s3Client)
}

/**
 * Create and ensure S3Datastore bucket exists.
 */
async function createS3Datastore(s3Client: S3Client): Promise<Datastore> {
	const bucket = process.env.S3_DATASTORE_BUCKET!

	logger.info({ bucket }, 'Creating S3 datastore')

	// Ensure bucket exists
	try {
		await s3Client.send(new HeadBucketCommand({ Bucket: bucket }))
		logger.info({ bucket }, 'S3 datastore bucket exists')
	} catch (err: any) {
		if (err.name === 'NoSuchBucket') {
			logger.info({ bucket }, 'Creating S3 datastore bucket')
			try {
				await s3Client.send(new CreateBucketCommand({ Bucket: bucket }))
				logger.info({ bucket }, 'S3 datastore bucket created')
			} catch (createErr) {
				logger.error({ bucket, error: String(createErr) }, 'Failed to create S3 datastore bucket')
				throw createErr
			}
		} else {
			logger.error({ bucket, error: String(err) }, 'Failed to check S3 datastore bucket')
			throw err
		}
	}

	return new S3Datastore(s3Client as any, bucket)
}

/**
 * Create datastore (S3 or memory).
 */
export async function createDatastore(s3Client?: S3Client): Promise<Datastore> {
	if (isMemoryStorageEnabled()) {
		logger.info('Creating in-memory datastore')
		return new MemoryDatastore()
	}

	if (!s3Client) throw new Error('S3Client required for S3Datastore')
	return createS3Datastore(s3Client)
}

/**
 * Create S3 health check closure.
 */
export function createS3HealthCheck(s3Client: S3Client | undefined): () => Promise<boolean> {
	return async (): Promise<boolean> => {
		if (isMemoryStorageEnabled()) {
			return true // Memory storage always "healthy"
		}

		try {
			const blockBucket = process.env.S3_BUCKET!
			await s3Client!.send(new HeadBucketCommand({ Bucket: blockBucket }), {
				abortSignal: AbortSignal.timeout(2000),
			})
			return true
		} catch {
			return false
		}
	}
}

/**
 * Set up storage layer (S3 or memory).
 */
export async function setupStorage(): Promise<{
	s3Client: S3Client | undefined
	rawBlockstore: Blockstore
	datastore: Datastore
}> {
	let s3Client: S3Client | undefined
	if (!isMemoryStorageEnabled()) {
		s3Client = createS3Client()
	}

	const rawBlockstore = await createBlockstore(s3Client)
	const datastore = await createDatastore(s3Client)

	return { s3Client, rawBlockstore, datastore }
}
