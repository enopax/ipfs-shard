import { logger } from '@/logger.js'

/**
 * Check if memory storage is enabled.
 */
export function isMemoryStorageEnabled(): boolean {
	return process.env.MEMORY_STORAGE === 'true' || process.env.MEMORY_STORAGE === '1'
}

/**
 * Validate required environment variables.
 * S3 credentials optional if MEMORY_STORAGE=true (development only).
 * Exit code 1 if S3 is required but missing.
 */
export function validateEnv(): void {
	const useMemory = isMemoryStorageEnabled()

	if (useMemory) {
		logger.warn(
			{
				message:
					'⚠️  MEMORY_STORAGE enabled - data will be lost on restart. For development only!',
			},
			'Using in-memory blockstore and datastore'
		)
		return
	}

	const required = ['S3_BUCKET', 'S3_DATASTORE_BUCKET', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY']
	const missing = required.filter((key) => !process.env[key])

	if (missing.length > 0) {
		logger.error({ missing }, 'Missing required environment variables')
		logger.info('Set MEMORY_STORAGE=true to use in-memory storage (development only)')
		process.exit(1)
	}

	logger.info('Environment variables validated')
}
