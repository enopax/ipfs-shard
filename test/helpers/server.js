import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'
import { writeFileSync, appendFileSync } from 'fs'
import { config } from 'dotenv'

// Load .env file
config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '../../')

const port = process.env.NODE_INTERNAL_PORT || 3001
const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${port}`

let childProcess = null
let alreadyRunning = false
let startCount = 0 // Track how many times startServer is called
let connectionAttempts = 0 // Track attempts waiting for peer connections

export async function startServer() {
	// Check if server is already running
	try {
		const response = await fetch(`${BASE_URL}/health`, { timeout: 5000 })
		if (response.ok) {
			console.log(`[server.js] Server already running (startCount: ${startCount + 1})`)
			alreadyRunning = true
			startCount++
			return
		}
	} catch (err) {
		// Server not running, proceed with startup
	}

	// Start the server
	return new Promise((resolve, reject) => {
		console.log(`[server.js] Starting server on port ${port}...`)

		const stdio = process.env.DEBUG_SERVER_LOGS === '1' ? 'inherit' : ['ignore', 'pipe', 'pipe']
		childProcess = spawn('node_modules/.bin/tsx', ['src/index.ts'], {
			cwd: projectRoot,
			stdio,
			env: {
				...process.env,
				NODE_ENV: 'test',
				LOG_LEVEL: process.env.LOG_LEVEL || 'debug',
			},
		})

		let isResolved = false
		let serverOutput = [] // Capture server output for debugging
		let serverErrors = [] // Capture server errors

		// Capture stdout and stderr if not in inherit mode
		if (stdio[1] !== 'inherit' && childProcess.stdout) {
			childProcess.stdout.on('data', (data) => {
				serverOutput.push(data.toString())
			})
		}

		if (stdio[2] !== 'inherit' && childProcess.stderr) {
			childProcess.stderr.on('data', (data) => {
				serverErrors.push(data.toString())
			})
		}

		childProcess.on('error', (err) => {
			if (!isResolved) {
				isResolved = true
				console.error('[server.js] Failed to start server:', err)
				if (serverErrors.length > 0) {
					console.error('[server.js] Server stderr:', serverErrors.join(''))
				}
				reject(err)
			}
		})

		childProcess.on('exit', (code, signal) => {
			if (!isResolved) {
				isResolved = true
				console.error(`[server.js] Server exited with code ${code} and signal ${signal}`)

				// Log captured output for debugging
				if (serverErrors.length > 0) {
					console.error('[server.js] === Server Error Output ===')
					console.error(serverErrors.join(''))
					console.error('[server.js] === End Error Output ===')
				}
				if (serverOutput.length > 0) {
					console.error('[server.js] === Server Output (Last 10 lines) ===')
					const lines = serverOutput.join('').split('\n')
					const lastLines = lines.slice(-10).filter((l) => l.trim())
					console.error(lastLines.join('\n'))
					console.error('[server.js] === End Output ===')
				}

				reject(new Error(`Server process exited with code ${code}`))
			}
		})

		// Poll for server health and DHT connectivity
		let attempts = 0
		const maxAttempts = 140 // 70 seconds with 500ms polling

		const checkHealth = async () => {
			try {
				const response = await fetch(`${BASE_URL}/health`, { timeout: 5000 })
				if (response.ok) {
					const body = await response.json()
					// Wait for at least 1 connection before considering DHT "ready"
					// This ensures bootstrap peer connection before proceeding
					if (body.connections > 0) {
						if (!isResolved) {
							isResolved = true
							startCount++
							console.log(`[server.js] Server ready with ${body.connections} peer connection(s) (startCount: ${startCount})`)
							resolve()
						}
						return
					}
					connectionAttempts++
					// If server is responding but no connections after 20s, proceed anyway
					// This allows tests to run in environments without peer connectivity
					if (connectionAttempts >= 40 && !isResolved) {
						isResolved = true
						startCount++
						console.warn('[server.js] Server ready but no peer connections after 20s - proceeding anyway')
						resolve()
						return
					}
				}
			} catch (err) {
				// Server not ready yet
			}

			attempts++
			if (attempts >= maxAttempts) {
				if (!isResolved) {
					isResolved = true
					console.error('[server.js] Server failed to establish peer connections after 70s')

					// Log captured errors
					if (serverErrors.length > 0) {
						console.error('[server.js] === Startup Error Output ===')
						console.error(serverErrors.join(''))
						console.error('[server.js] === End Error Output ===')
					}

					reject(new Error('Server failed to establish peer connections within 70 seconds'))
				}
				return
			}

			setTimeout(checkHealth, 500)
		}

		connectionAttempts = 0 // Reset counter for this server startup
		checkHealth()

		// Cleanup on unexpected exit
		process.on('exit', () => {
			if (childProcess && !alreadyRunning) {
				childProcess.kill()
			}
		})
	})
}

export async function stopServer() {
	// ALWAYS skip stopping the server from individual tests
	// Individual test files should NOT kill the shared server
	// The server will be cleaned up when the process exits
	console.log('[server.js] Test suite stopped calling stopServer - server remains running for other tests')
	return

	if (!childProcess) {
		console.log('[server.js] No server process to stop')
		return
	}

	return new Promise((resolve) => {
		console.log('[server.js] Stopping server...')

		const timeout = setTimeout(() => {
			console.warn('[server.js] Server did not close within 5s, force killing')
			childProcess.kill('SIGKILL')
			resolve()
		}, 5000)

		childProcess.once('close', () => {
			clearTimeout(timeout)
			console.log('[server.js] Server stopped')
			resolve()
		})

		childProcess.kill('SIGTERM')
	})
}

// Default export for --test-global-setup
export default async function setup() {
	// Set env var so workers know global setup started this server
	process.env.IPFS_TEST_GLOBAL_SETUP_RUNNING = '1'
	const debugFile = '/tmp/ipfs-test-setup-debug.txt'
	appendFileSync(debugFile, `[${new Date().toISOString()}] setup() called, setting IPFS_TEST_GLOBAL_SETUP_RUNNING=1\n`)
	appendFileSync(debugFile, `[${new Date().toISOString()}] env var is now: ${process.env.IPFS_TEST_GLOBAL_SETUP_RUNNING}\n`)
	await startServer()
	return async function globalTeardown() {
		// Unset the flag so stopServer will actually kill the server
		appendFileSync(debugFile, `[${new Date().toISOString()}] globalTeardown() called, deleting IPFS_TEST_GLOBAL_SETUP_RUNNING\n`)
		delete process.env.IPFS_TEST_GLOBAL_SETUP_RUNNING
		appendFileSync(debugFile, `[${new Date().toISOString()}] env var is now: ${process.env.IPFS_TEST_GLOBAL_SETUP_RUNNING}\n`)
		await stopServer()
	}
}
