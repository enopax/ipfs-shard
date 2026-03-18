import pino from 'pino'

const isDev = process.env.NODE_ENV !== 'production'

const logLevel = process.env.LOG_LEVEL || 'info'

// Determine if peer logging should be enabled
// Enabled ONLY when LOG_LEVEL='peer' or 'trace' (not 'debug')
// This keeps peer spam out of debug logs
function shouldLogPeer(): boolean {
	return logLevel === 'peer' || logLevel === 'trace'
}

// Determine if bitswap logging should be enabled
// Enabled ONLY when LOG_LEVEL='bitswap' or 'trace' (not 'debug')
// This keeps bitswap spam out of debug logs
function shouldLogBitswap(): boolean {
	return logLevel === 'bitswap' || logLevel === 'trace'
}

// Determine if DHT logging should be enabled
// Enabled ONLY when LOG_LEVEL='dht' or 'trace' (not 'debug')
// This keeps DHT spam out of debug logs
function shouldLogDHT(): boolean {
	return logLevel === 'dht' || logLevel === 'trace'
}

// Create base logger configuration
const loggerConfig: any = {
	level: logLevel === 'peer' || logLevel === 'bitswap' || logLevel === 'dht' ? 'debug' : logLevel, // Map 'peer'/'bitswap'/'dht' to 'debug' for pino
	...(isDev && {
		transport: {
			target: 'pino-pretty',
			options: {
				colorize: true,
				singleLine: true,
				translateTime: 'SYS:standard',
			},
		},
	}),
}

export const logger = pino(loggerConfig)

/**
 * Log peer events (connections, disconnections, discoveries).
 * Only logs if LOG_LEVEL includes 'peer' or is 'debug'/'trace'.
 */
export const logPeer = (message: string, data?: Record<string, any>) => {
	if (shouldLogPeer()) {
		logger.debug(data || {}, message)
	}
}

/**
 * Log bitswap events (wants, provides, peer broadcasts).
 * Only logs if LOG_LEVEL includes 'bitswap' or is 'trace'.
 */
export const logBitswap = (message: string, data?: Record<string, any>) => {
	if (shouldLogBitswap()) {
		logger.debug(data || {}, message)
	}
}

/**
 * Log DHT events (announcements, provider lookups, DHT operations).
 * Only logs if LOG_LEVEL includes 'dht' or is 'trace'.
 */
export const logDHT = (message: string, data?: Record<string, any>) => {
	if (shouldLogDHT()) {
		logger.debug(data || {}, message)
	}
}
