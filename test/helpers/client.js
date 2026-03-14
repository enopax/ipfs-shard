import { config } from 'dotenv'

// Load .env file to get NODE_INTERNAL_PORT (suppress tips during tests)
config({ quiet: true })

const port = process.env.NODE_INTERNAL_PORT || 3001
export const BASE_URL = process.env.TEST_BASE_URL || `http://localhost:${port}`

/**
 * Parameterised client factory for tests using in-process servers.
 * Pass baseUrl from createTestServer()'s result.
 */
export function createClient(baseUrl) {
	return {
		async get(path) {
			const response = await fetch(`${baseUrl}${path}`)
			const text = await response.text()
			let body = {}
			try {
				body = text ? JSON.parse(text) : {}
			} catch (err) {
				body = { error: `Failed to parse response: ${text}` }
			}
			return { status: response.status, body }
		},

		async post(path, data) {
			const response = await fetch(`${baseUrl}${path}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			})
			const text = await response.text()
			let body = {}
			try {
				body = text ? JSON.parse(text) : {}
			} catch (err) {
				body = { error: `Failed to parse response: ${text}` }
			}
			return { status: response.status, body }
		},

		async getRaw(path) {
			const response = await fetch(`${baseUrl}${path}`)
			const text = await response.text()
			return { status: response.status, text }
		},

		async postQuery(path) {
			const response = await fetch(`${baseUrl}${path}`, {
				method: 'POST',
			})
			const body = await response.json()
			return { status: response.status, body }
		},

		async del(path, data) {
			const response = await fetch(`${baseUrl}${path}`, {
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(data),
			})
			const text = await response.text()
			let body = {}
			try {
				body = text ? JSON.parse(text) : {}
			} catch (err) {
				body = { error: `Failed to parse response: ${text}` }
			}
			return { status: response.status, body }
		},
	}
}

// Static exports for integration tests (backwards compatibility)
export async function get(path) {
	const response = await fetch(`${BASE_URL}${path}`)
	const text = await response.text()
	let body = {}
	try {
		body = text ? JSON.parse(text) : {}
	} catch (err) {
		body = { error: `Failed to parse response: ${text}` }
	}
	return { status: response.status, body }
}

export async function post(path, data) {
	const response = await fetch(`${BASE_URL}${path}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	const text = await response.text()
	let body = {}
	try {
		body = text ? JSON.parse(text) : {}
	} catch (err) {
		body = { error: `Failed to parse response: ${text}` }
	}
	return { status: response.status, body }
}

export async function getRaw(path) {
	const response = await fetch(`${BASE_URL}${path}`)
	const text = await response.text()
	return { status: response.status, text }
}

export async function postQuery(path) {
	const response = await fetch(`${BASE_URL}${path}`, {
		method: 'POST',
	})
	const body = await response.json()
	return { status: response.status, body }
}

export async function del(path, data) {
	const response = await fetch(`${BASE_URL}${path}`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(data),
	})
	const text = await response.text()
	let body = {}
	try {
		body = text ? JSON.parse(text) : {}
	} catch (err) {
		body = { error: `Failed to parse response: ${text}` }
	}
	return { status: response.status, body }
}
