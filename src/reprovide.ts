import type { IPFSNode } from './ipfs-node.js'
import { logger } from './logger.js'
import { CID } from 'multiformats'
import {
	reprovideCounter,
	reprovideErrorCounter,
	reprovideLastRunGauge,
	reprovideDurationGauge,
} from './metrics.js'

const REPROVIDE_INTERVAL_MS = 22 * 60 * 60 * 1000 // 22 hours
const INITIAL_DELAY_MS = 5 * 60 * 1000 // 5 minutes
const WARNING_DURATION_MS = 60 * 60 * 1000 // 1 hour

/**
 * Start the DHT re-provide loop.
 * Returns a stop function for graceful shutdown.
 *
 * Behaviour:
 * - First run: delayed by 5 minutes (DHT warm-up)
 * - Interval: every 22 hours
 * - Loop: collects all CIDs from node.pins.ls(), processes sequentially
 * - Per-CID: calls node.routing.provide(cid), increments counters, sets DHT status
 * - Progress: logs at start, every 100 CIDs, and at end with summary + duration
 * - Gauges: sets reprovideLastRunGauge and reprovideDurationGauge at end of each run
 * - Warning: logs if a full run takes > 1 hour
 * - Stop: clears both setTimeout and setInterval
 */
export function startReprovideLoop(node: IPFSNode): () => void {
	let stopped = false
	let timeoutId: NodeJS.Timeout | null = null
	let intervalId: NodeJS.Timeout | null = null

	const runReprovideLoop = async () => {
		if (stopped) return

		const startTime = Date.now()
		const startLogTime = new Date().toISOString()

		try {
			// Collect all CIDs first
			const cids: string[] = []
			for await (const { cid } of node.pins.ls()) {
				cids.push(cid.toString())
			}

			logger.info(
				{ totalCids: cids.length, startTime: startLogTime },
				'Re-provide loop started'
			)

			let successCount = 0
			let errorCount = 0

			// Process CIDs sequentially
			for (let i = 0; i < cids.length; i++) {
				if (stopped) break

				const cidStr = cids[i]
				try {
					const cid = CID.parse(cidStr)
					await node.routing.provide(cid)
					reprovideCounter.inc()
					successCount++

					// Update DHT status
					try {
						await node.dht.setStatus(cid, {
							status: 'success',
							announcedAt: Date.now(),
						})
					} catch {
						// Ignore DHT status update failures
					}
				} catch (err) {
					reprovideErrorCounter.inc()
					errorCount++
					logger.warn(
						{ cid: cidStr, error: String(err) },
						'Failed to re-provide CID'
					)
				}

				// Log progress every 100 CIDs
				if ((i + 1) % 100 === 0) {
					logger.info(
						{ processed: i + 1, totalCids: cids.length },
						'Re-provide progress'
					)
				}
			}

			// Calculate duration
			const duration = Date.now() - startTime
			const durationSeconds = duration / 1000

			// Set gauges
			reprovideLastRunGauge.set(Math.floor(Date.now() / 1000))
			reprovideDurationGauge.set(durationSeconds)

			// Log warning if run took too long
			if (duration > WARNING_DURATION_MS) {
				logger.warn(
					{ durationSeconds, totalCids: cids.length },
					'Re-provide loop took longer than 1 hour (interval may be too tight for pin set size)'
				)
			}

			logger.info(
				{
					durationSeconds,
					totalCids: cids.length,
					successCount,
					errorCount,
				},
				'Re-provide loop completed'
			)
		} catch (err) {
			logger.error({ error: String(err) }, 'Error during re-provide loop')
		}
	}

	// Start initial timer with 5 minute delay
	timeoutId = setTimeout(() => {
		// Run the loop immediately first time
		runReprovideLoop()

		// Then schedule it to run every 22 hours
		intervalId = setInterval(runReprovideLoop, REPROVIDE_INTERVAL_MS)
	}, INITIAL_DELAY_MS)

	const stop = () => {
		if (stopped) return

		stopped = true
		if (timeoutId) clearTimeout(timeoutId)
		if (intervalId) clearInterval(intervalId)
		logger.info('Re-provide loop stopped')
	}

	logger.info(
		{ initialDelayMs: INITIAL_DELAY_MS, intervalMs: REPROVIDE_INTERVAL_MS },
		'Re-provide loop started'
	)
	return stop
}
