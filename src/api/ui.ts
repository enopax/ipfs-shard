import http from 'http'
import type { RouteContext } from './http-router.js'

export async function handleUi(
	ctx: RouteContext,
	req: http.IncomingMessage,
	res: http.ServerResponse
): Promise<boolean> {
		const html = `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta name="viewport" content="width=device-width, initial-scale=1">
			<title>IPFS Shard API Proof of Concept</title>
		</head>
		<body>
			<h1>IPFS Shard API Proof of Concept</h1>
			<p>Test all shard features by hitting the real API endpoints.</p>

			<h2>Health & Status</h2>
			<button onclick="callEndpoint('GET', '/health')">GET /health</button>

			<h2>Stats</h2>
			<button onclick="callEndpoint('GET', '/stats')">GET /stats</button>

			<h2>Peers</h2>
			<button onclick="callEndpoint('GET', '/peers')">GET /peers</button>

			<h2>Connections</h2>
			<button onclick="callEndpoint('GET', '/connections')">GET /connections</button>

			<h2>Pins</h2>
			<button onclick="callEndpoint('GET', '/pins')">GET /pins</button>

			<h2>Block Exists</h2>
			<input type="text" id="blocksCid" placeholder="Enter CID">
			<button onclick="callEndpoint('GET', '/blocks/' + document.getElementById('blocksCid').value)">GET /blocks/:cid</button>

			<h2>Cat Block (Read)</h2>
			<input type="text" id="catCid" placeholder="Enter CID">
			<button onclick="callEndpoint('GET', '/cat/' + document.getElementById('catCid').value)">GET /cat/:cid</button>

			<h2>List Directory</h2>
			<input type="text" id="lsCid" placeholder="Enter CID">
			<button onclick="callEndpoint('GET', '/ls/' + document.getElementById('lsCid').value)">GET /ls/:cid</button>

			<h2>DHT Providers</h2>
			<input type="text" id="providersCid" placeholder="Enter CID">
			<button onclick="callEndpoint('GET', '/providers/' + document.getElementById('providersCid').value)">GET /providers/:cid</button>

			<h2>DHT Status</h2>
			<input type="text" id="dhtStatusCid" placeholder="Enter CID">
			<button onclick="callEndpoint('GET', '/dht/status/' + document.getElementById('dhtStatusCid').value)">GET /dht/status/:cid</button>

			<h2>Pin a CID</h2>
			<input type="text" id="pinCid" placeholder="Enter CID">
			<button onclick="postEndpoint('/pin', document.getElementById('pinCid').value)">POST /pin</button>

			<h2>Unpin a CID</h2>
			<input type="text" id="unpinCid" placeholder="Enter CID">
			<button onclick="deleteEndpoint('/pin', document.getElementById('unpinCid').value)">DELETE /pin</button>

			<h2>Announce CID</h2>
			<input type="text" id="announceCid" placeholder="Enter CID">
			<button onclick="postEndpoint('/announce', document.getElementById('announceCid').value)">POST /announce</button>

			<h2>Ping Peer</h2>
			<input type="text" id="pingPeer" placeholder="Enter multiaddr (e.g., /ip4/1.2.3.4/tcp/4001/p2p/12D3Koo...)">
			<button onclick="pingEndpoint(document.getElementById('pingPeer').value)">POST /ping</button>

			<h2>Response</h2>
			<pre id="response">Response will appear here...</pre>

			<script>
				async function callEndpoint(method, path) {
					const responseEl = document.getElementById('response');
					responseEl.textContent = 'Loading...';
					try {
						const res = await fetch(path);
						const data = await res.json();
						responseEl.textContent = JSON.stringify(data, null, 2);
					} catch (err) {
						responseEl.textContent = 'Error: ' + err.message;
					}
				}

				async function postEndpoint(path, cid) {
					if (!cid) {
						document.getElementById('response').textContent = 'Error: Please enter a CID';
						return;
					}
					const responseEl = document.getElementById('response');
					responseEl.textContent = 'Loading...';
					try {
						const res = await fetch(path, {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ cid })
						});
						const data = await res.json();
						responseEl.textContent = JSON.stringify(data, null, 2);
					} catch (err) {
						responseEl.textContent = 'Error: ' + err.message;
					}
				}

				async function deleteEndpoint(path, cid) {
					if (!cid) {
						document.getElementById('response').textContent = 'Error: Please enter a CID';
						return;
					}
					const responseEl = document.getElementById('response');
					responseEl.textContent = 'Loading...';
					try {
						const res = await fetch(path, {
							method: 'DELETE',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ cid })
						});
						const data = await res.json();
						responseEl.textContent = JSON.stringify(data, null, 2);
					} catch (err) {
						responseEl.textContent = 'Error: ' + err.message;
					}
				}

				async function pingEndpoint(peer) {
					if (!peer) {
						document.getElementById('response').textContent = 'Error: Please enter a multiaddr';
						return;
					}
					const responseEl = document.getElementById('response');
					responseEl.textContent = 'Loading...';
					try {
						const res = await fetch('/ping', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json' },
							body: JSON.stringify({ peer })
						});
						const data = await res.json();
						responseEl.textContent = JSON.stringify(data, null, 2);
					} catch (err) {
						responseEl.textContent = 'Error: ' + err.message;
					}
				}
			</script>
		</body>
		</html>`
	res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
	res.end(html)
	return true
}
