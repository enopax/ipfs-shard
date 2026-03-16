# ipfs-shard

> **A production-ready, server-native IPFS node with strong peer connectivity and S3 storage adapters**

![Tests](https://img.shields.io/badge/tests-45%20passing-brightgreen)
![Node.js](https://img.shields.io/badge/node-v24-green)
![License](https://img.shields.io/badge/license-MIT-blue)

**ipfs-shard** is a lightweight, self-contained IPFS peer built on **libp2p v3** and S3-backed distributed storage. Ipfs-shard runs as a **full DHT server node** with **aggressive peer discovery** (300+ peers typical).

Perfect for:
- Building decentralised file storage systems with persistent, scalable S3 backends
- Running IPFS infrastructure without heavy nodes
- Server-native deployments (no browser requirements)
- High-performance content routing and block exchange with automatic network fallbacks (bitswap → DHT → gateway)
- Local or production IPFS infrastructure with strong network participation

## Features

✓ **Custom IPFSNode class** — Direct libp2p control, no Helia abstraction layer
✓ **Server-native** — Runs on Node.js v24 without browser dependencies
✓ **Aggressive peer discovery** — 300+ peers typical via active DHT announcements + pruning
✓ **Full DHT server** — Kademlia DHT participation with 5-second periodic announcements
✓ **Connection cycling** — Automatic peer rotation (300 ceiling) for optimal network health
✓ **S3 storage** — MinIO, AWS S3, or any S3-compatible backend with persistent state
✓ **Network fallback** — Block retrieval: S3 → Bitswap (5s timeout) → DHT (5s) → Gateway
✓ **Multi-protocol bitswap** — Negotiates bitswap/1.0.0, 1.1.0, 1.2.0 for wider peer compatibility
✓ **HTTP REST API** — Peer management, DHT lookups, content announcements, health checks
✓ **Prometheus metrics** — Request tracking, block retrieval counters, pin inventory, DHT re-provision
✓ **Comprehensive tests** — 45 automated tests covering connectivity, blocks, DHT, bitswap

## Quick Start

### Prerequisites
- **Node.js v24** (`node --version`)
- **S3 Credentials** (optional)

### 1. Clone and Install

```bash
git clone https://github.com/enopax/ipfs-shard.git
cd ipfs-shard
npm install
```

### 2. Configure Environment

Create `.env`:
```bash
# S3 Storage
S3_ENDPOINT=http://localhost:9000
S3_BLOCKSTORE_BUCKET=glashaus-blocks
S3_DATASTORE_BUCKET=glashaus-data
S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin

# Node Configuration
NODE_INTERNAL_PORT=4000
LOG_LEVEL=info

# Optional: Public IP for peer announcements
ANNOUNCE_IP=127.0.0.1
```

### 3. Run

```bash
npm run dev
```

### 4. Verify Health

```bash
curl http://localhost:4000/health
```

Expected response:
```json
{
  "peerId": "12D3KooW...",
  "connections": 0,
  "dhtMode": "server",
  "uptime": 5,
  "multiaddrs": [
    "/ip4/127.0.0.1/tcp/4001",
    "/ip4/127.0.0.1/tcp/4002/ws"
  ]
}
```

## Architecture

### System Overview

```
Your Application (HTTP API, port 4000)
         ↓
    IPFSNode (Custom class: libp2p + blockstore + S3 storage)
         ├─ libp2p v3 (P2P networking)
         │  ├─ TCP + WebSocket transports
         │  ├─ Kademlia DHT (server mode, full participant)
         │  ├─ Bootstrap peers (2-3 initial connections)
         │  ├─ Active DHT announcements (every 5s)
         │  └─ Connection manager (300 peer ceiling, auto-pruning)
         │
         ├─ SimpleBitswap (block exchange)
         │  ├─ Multi-protocol negotiation (1.0.0, 1.1.0, 1.2.0)
         │  ├─ Bidirectional streams per peer
         │  └─ Network-aware fallback to DHT
         │
         ├─ NetworkAwareBlockstore (intelligent retrieval chain)
         │  ├─ Layer 1: Local S3 blockstore (instant)
         │  ├─ Layer 2: Bitswap broadcast (5s timeout)
         │  ├─ Layer 3: DHT provider queries (5s timeout)
         │  └─ Layer 4: Public gateway (fallback)
         │
         ├─ S3 Storage (persistent, scalable)
         │  ├─ Blockstore (IPFS content blocks)
         │  └─ Datastore (peer state, pins, metadata)
         │
         └─ Network Health
            ├─ DHT re-provide loop (24h, prevents expiry)
            ├─ Bootstrap dial loop (30s reconnect)
            └─ Peer discovery metrics + monitoring
```

**Expected peer count by network maturity:**
- **Startup (10s):** 2-5 peers (bootstrap)
- **Growth (1 min):** 50-100 peers (DHT announcements cascade)
- **Mature (5 min):** 200-300 peers (hitting connection ceiling)
- **Stable state:** Continuous 200-300 peer oscillation (optimal for discovery)

### Directory Structure

```
src/
├── index.ts                 # Main entry point (S3 setup, server startup)
├── ipfs-node.ts             # Custom IPFSNode class (libp2p + storage)
├── libp2p-config.ts         # libp2p configuration (transports, DHT, bootstrap)
├── bitswap.ts               # SimpleBitswap implementation (block exchange)
├── blockstore-network.ts    # NetworkAwareBlockstore (S3 + network fallback)
├── blockstore-cache.ts      # Optional LRU cache layer
├── internal-api.ts          # HTTP API endpoints
├── metrics.ts               # Prometheus metrics setup
├── reprovide.ts             # DHT re-provide loop (24h refresh)
└── logger.ts                # Structured logging (Pino)

test/
├── health.spec.js           # Health endpoint tests
├── peers.spec.js            # Peer connectivity tests
├── blocks.spec.js           # Block existence checks
├── bitswap.spec.js          # Bitswap protocol tests
└── ...                       # Other endpoint tests
```

## Network Security

### Two Separate Networks

**ipfs-shard** operates two distinct networks with different security requirements:

#### 1. HTTP API (Port 4000) — Secured Admin Interface
- **Purpose:** Applications control the IPFS node (upload announcements, block checks, metrics)
- **Endpoints:** `/health`, `/pin`, `/announce`, `/metrics`, etc.
- **Default binding:** `0.0.0.0` (all interfaces)
- **Security:** API key authentication required in production

```env
# .env — Production
NODE_ENV=production
API_KEY=your-secret-key-here         # Required for authentication
ALLOWED_ORIGINS=https://yourapp.com  # CORS whitelist
```

**Authentication:** All requests in production must include the `X-Api-Key` header:
```bash
curl -H "X-Api-Key: your-secret-key" http://api.example.com/health
```

**No longer required to restrict to localhost** — The API is now secured with API key authentication. You can bind to `0.0.0.0` and expose the API publicly. See [docs/API_AUTH.md](docs/API_AUTH.md) for complete authentication setup and Next.js integration.

#### 2. libp2p Ports (4001 TCP, 4002 WebSocket) — P2P Network
- **Purpose:** Peer-to-peer IPFS communication
- **Default binding:** `0.0.0.0` (must be internet-facing)
- **Requirement:** Must remain **publicly accessible** for IPFS functionality
- **Ports:**
  - `4001/tcp` — Primary peer connections
  - `4002/tcp/ws` — WebSocket (browser compatibility)

```env
LIBP2P_PORT=4001            # Must be public
LIBP2P_WS_PORT=4002        # Must be public
```

**Why public?** The node must participate in:
- Block exchange (Bitswap)
- Distributed Hash Table (DHT)
- Peer discovery
- Content routing

These operations are cryptographically signed and designed for untrusted networks. Peers cannot exploit your node through libp2p ports alone.

### Security Summary

| Network | Port | Public | Security |
|---------|------|--------|----------|
| HTTP API | 4000 | ✅ Can be public | API key authentication required |
| libp2p | 4001-4002 | ✅ Must be public | Cryptographic signing + untrusted network design |

## API Endpoints

All endpoints on port 4000 (configurable via `NODE_INTERNAL_PORT`).

### Health & Status
- `GET /health` — Node health, peer ID, connections, multiaddrs

### Network Operations
- `GET /peers` — List all connected peer IDs
- `GET /connections` — Active connections with encryption/muxer metadata
- `POST /ping` — Measure latency to a peer
- `POST /connect` — Dial a peer by multiaddr

### Content Retrieval & Routing
- `GET /blocks/:cid` — Check if a block exists in local S3 storage
- `GET /cat/:cid` — Retrieve and stream content (with network fallback)
- `GET /providers/:cid` — Query DHT for content providers
- `POST /announce` — Announce content to DHT (called after upload)

### Metrics & Monitoring
- `GET /metrics` — Prometheus metrics (HTTP requests, blocks retrieved, pins, etc.)

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the complete API specification and examples.

## Environment Variables

### Required
- `S3_ENDPOINT` — MinIO/S3 endpoint (e.g., `http://localhost:9000`)
- `S3_BLOCKSTORE_BUCKET` — Bucket name for IPFS blocks
- `S3_DATASTORE_BUCKET` — Bucket name for metadata (pins, peer records)
- `AWS_ACCESS_KEY_ID` — S3 credentials
- `AWS_SECRET_ACCESS_KEY` — S3 credentials

### Optional
- `S3_REGION` — AWS region (default: `us-east-1`)
- `NODE_ENV` — Environment mode (`development` or `production`); dev mode disables API key checks (default: `development`)
- `API_KEY` — Secret authentication key for securing the HTTP API in production (required for production deployments)
- `ALLOWED_ORIGINS` — Comma-separated list of allowed CORS origins in production (e.g., `https://yourapp.com`)
- `NODE_INTERNAL_PORT` — API port (default: `4000`)
- `API_HOST` — HTTP API binding address (`0.0.0.0` for public access or `127.0.0.1` for localhost; default: `0.0.0.0`) — **API key authentication required in production**
- `ANNOUNCE_IP` — Public IP for peer announcements (critical for public deployments; default: `127.0.0.1`)
- `LIBP2P_PORT` — TCP port (default: `4001`)
- `LIBP2P_WS_PORT` — WebSocket port (default: `4002`)
- `BOOTSTRAP_PEERS` — Comma-separated bootstrap multiaddrs (default: 5 Kubo peers)
- `LOG_LEVEL` — Logging level: `trace`, `debug`, `info`, `warn`, `error`, `peer` (default: `info`)
- `BLOCK_CACHE_MB` — LRU block cache size in MB (default: `0`, disabled)
- `BITSWAP_WANT_TIMEOUT_MS` — Bitswap timeout in ms (default: `5000`)
- `DHT_PROVIDER_TIMEOUT_MS` — DHT provider query timeout in ms (default: `5000`)

**Peer Discovery Performance Settings** (edit in `src/libp2p-config.ts`)
- `maxConnections: 300` — Connection ceiling (triggers pruning, default Kubo full-node value)
- `maxParallelDials: 100` — Concurrent peer dials during discovery
- `dialTimeout: 5000` — Timeout per dial attempt (fail fast strategy)
- `maxDialQueueLength: 500` — Queue size for pending dials

## Testing

All tests use Node.js v24 built-in test runner.

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:health
npm run test:peers
npm run test:blocks

# Watch mode for development
npm run test:watch
```

**Test coverage:** 45 passing tests covering health checks, peer connectivity, peer discovery, blocks, bitswap integration, DHT queries, and more.

See [docs/TESTING.md](docs/TESTING.md) for detailed testing guide and troubleshooting.

## Development

### Code Structure & Patterns

See [docs/BEST-PRACTISES.md](docs/BEST-PRACTISES.md) for:
- Network operation patterns
- Testing strategies
- API design guidelines
- Common gotchas and how to avoid them

### Key Technical Decisions

**Why custom IPFSNode?**
- Direct libp2p control for production deployments
- No abstraction layer overhead
- Better observability and debugging
- Server-native (no browser compatibility needed)
- Smaller dependency tree

**Why multi-protocol bitswap?**
- Not all peers support bitswap 1.2.0
- Wider peer compatibility (1.0.0, 1.1.0, 1.2.0)
- libp2p negotiates highest supported version automatically
- Reduces "UnsupportedProtocolError" failures

**Why active DHT announcements?**
- Passive DHT queries alone are too slow for peer discovery
- Active DHT puts (announcements) force network participation and peer connections
- Every 5-second announcement discovers 3-5 new peers
- Creates exponential peer growth: 2→10→50→200→300 in 2-3 minutes
- Connection ceiling (300 peers) maintains optimal network health via auto-pruning

**Why not IPNI?**
- IPNI is for content lookups (providers), not peer discovery
- Active DHT announcements already provide excellent peer discovery
- Reduces external service dependencies

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-thing`)
3. Commit your changes (`git commit -m 'Add amazing thing'`)
4. Push to the branch (`git push origin feature/amazing-thing`)
5. Open a Pull Request

Ensure all tests pass: `npm test`

## Dependencies

### Core
- **libp2p** (v3.1.5) — P2P networking foundation
- **@libp2p/tcp** — TCP transport
- **@libp2p/websockets** — WebSocket transport
- **@libp2p/kad-dht** — Kademlia DHT for peer discovery
- **@libp2p/bootstrap** — Bootstrap peer discovery
- **@libp2p/identify** — Peer identification protocol
- **@libp2p/ping** — Peer latency measurement

### Storage
- **blockstore-s3** (v3) — S3-backed IPFS blockstore
- **datastore-s3** (v13) — S3-backed IPFS datastore
- **@aws-sdk/client-s3** — AWS S3 client

### Protocols & Encoding
- **multiformats** (v13) — CID and hash handling
- **@multiformats/multiaddr** — Multiaddr parsing
- **it-length-prefixed** — Bitswap wire format

### Monitoring & Logging
- **prom-client** (v15) — Prometheus metrics
- **pino** (v10) — Structured JSON logging
- **pino-pretty** — Pretty console output

### Development
- **tsx** — Fast TypeScript execution
- **nodemon** — File watcher for dev
- **typescript** — TypeScript compiler

## Known Limitations

- **Bootstrap peers:** Manually configured (default: 5 peers, customisable)
- **Peer identity:** Stored in S3; changes if S3 bucket/region changes
- **NAT traversal:** Requires ANNOUNCE_IP for public deployments
- **Connection limits:** No built-in rate limiting (add via reverse proxy)

## License

MIT — See [LICENSE](LICENSE) file.

## Further Reading

- **[docs/README.md](docs/README.md)** — Documentation index
- **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Deep dive into system design
- **[docs/PEER_DISCOVERY.md](docs/PEER_DISCOVERY.md)** — Peer discovery & DHT operation
- **[docs/BEST-PRACTISES.md](docs/BEST-PRACTISES.md)** — Development patterns and best practices
- **[docs/TESTING.md](docs/TESTING.md)** — Test suite guide
- **[docs/GATEWAY_INTEGRATION.md](docs/GATEWAY_INTEGRATION.md)** — IPFS gateway integration
- **[libp2p Docs](https://docs.libp2p.io)** — libp2p reference
- **[IPFS Specs](https://specs.ipfs.tech)** — IPFS protocol specifications

## Support

- **Issues:** [GitHub Issues](https://github.com/enopax/ipfs-shard/issues)
- **Discussions:** [GitHub Discussions](https://github.com/enopax/ipfs-shard/discussions)
- **Documentation:** See [docs/](docs/) directory

---

Built with ❤️ for the decentralised web
