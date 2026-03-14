# ipfs-shard Documentation

Comprehensive documentation for the production-ready IPFS node with S3 storage.

> **New (v0.7+):** Helia has been replaced with a custom IPFSNode class for direct libp2p + S3 integration. See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## Overview

**ipfs-shard** is a production-ready, server-native IPFS peer that:
- Stores content blocks in S3/MinIO (distributed, scalable storage)
- Runs as a **full DHT server node** (serves other peers and participates in network)
- Exposes a lightweight HTTP API for DHT queries, peer discovery, and content lookup
- Integrates with Next.js for file upload orchestration
- Handles zero-knowledge content announcements to the DHT
- Includes built-in Prometheus metrics and health monitoring
- **Custom IPFSNode class** for direct control over libp2p + S3 integration (v0.7+)

Use case: Build a decentralised file storage system where Next.js handles authentication/uploads and helia-shard peers store and serve content via IPFS.

## Quick Start

### Prerequisites
- **Node.js v24** (`node --version`)
- **Docker** with Docker Compose (for MinIO + services)

### 1. Clone and Install
```bash
git clone <repo>
cd js/helia-shard
npm install
```

### 2. Start MinIO (Docker)
```bash
# From parent directory with docker-compose.yml
docker-compose up -d minio
docker-compose up -d minio-init

# Wait for MinIO to be healthy
curl http://localhost:9000/minio/health/live
```

### 3. Configure `.env`
```bash
# S3 Storage
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=glashaus-blocks
S3_DATASTORE_BUCKET=glashaus-data
S3_REGION=eu-central-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin

# API Server
NODE_INTERNAL_PORT=3001
LOG_LEVEL=debug
```

### 4. Run
```bash
npm run dev
```

### 5. Test
```bash
# In another terminal
curl http://localhost:3001/health
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

### Layers

1. **Storage Layer**
   - S3 Blockstore: IPFS content blocks stored in MinIO/S3
   - S3 Datastore: Helia's internal metadata (keys, DHT records)

2. **Network Layer**
   - libp2p: P2P networking (TCP + WebSocket transports)
   - Noise encryption, Yamux multiplexing
   - Kademlia DHT (server mode)

3. **Application Layer**
   - Internal HTTP API (port 3001) for queries
   - Integration with Next.js for file uploads

### Data Flow

```
Next.js App                    helia-shard                      IPFS DHT
─────────────                  ────────────                      ────────
1. User uploads file
   │
   ├─→ /add (to S3 blockstore)
   │
   ├─→ /announce (broadcast CID to DHT)
   │                             ││
   │                             ││ Announces content
   │                             ││ to DHT peers
   │                             └───────────────→ [DHT Peers]
   │
2. Other users search DHT
   │                             /providers/:cid (queries DHT)
   │←───────────────────────────←──┤
   │
3. Content fetched via gateway
```

## API Endpoints

All endpoints on port 3001 (configurable).

### Health & Status
- `GET /health` — Node status, peer ID, connections, multiaddrs

### Network
- `GET /peers` — List peer IDs
- `GET /connections` — Active connections with metadata
- `POST /ping` — Measure latency to a peer

### DHT & Content
- `GET /providers/:cid` — Find content providers on DHT
- `GET /blocks/:cid` — Check if block exists in blockstore
- `POST /announce` — Announce content to DHT (called by Next.js)

See [NETWORK_API.md](NETWORK_API.md) for full API documentation.

## Environment Variables

### Required
- `S3_ENDPOINT` — MinIO/S3 endpoint
- `S3_BUCKET` — Content blocks bucket
- `S3_DATASTORE_BUCKET` — Helia metadata bucket
- `AWS_ACCESS_KEY_ID` — S3 credentials
- `AWS_SECRET_ACCESS_KEY` — S3 credentials

### Optional
- `S3_REGION` — AWS region (default: `us-east-1`)
- `LIBP2P_PORT` — TCP port (default: `4001`)
- `LIBP2P_WS_PORT` — WebSocket port (default: `4002`)
- `ANNOUNCE_IP` — Public IP to announce (default: `127.0.0.1`)
- `BOOTSTRAP_PEERS` — Comma-separated bootstrap multiaddrs (optional)
- `NODE_INTERNAL_PORT` — API port (default: `3001`)
- `LOG_LEVEL` — `debug`, `info`, `warn`, `error` (default: `info`)
- `NODE_ENV` — `development` or `production`
- `BLOCK_CACHE_MB` — LRU cache size (default: `0`)
- `PROVIDERS_TIMEOUT_MS` — DHT query timeout (default: `15000`)

See [CLAUDE.md](../CLAUDE.md) for comprehensive documentation.

## Testing

Tests use Node.js v24 built-in test runner.

```bash
# All tests
npm test

# Individual suites
npm run test:health
npm run test:peers
npm run test:ping
npm run test:providers
npm run test:blocks

# Watch mode
npm run test:watch
```

See [TESTING.md](TESTING.md) for detailed testing guide.

## Docker Deployment

See [DOCKER_SETUP.md](DOCKER_SETUP.md) for production Docker Compose configuration.

## Project Structure

```
src/
├── index.ts              — Main entry: S3 setup, IPFSNode init, startup
├── ipfs-node.ts          — Custom IPFSNode class (libp2p + blockstore + pinning)
├── libp2p-config.ts      — libp2p configuration (transports, DHT, services)
├── bitswap.ts            — Custom SimpleBitswap block exchange protocol
├── blockstore-network.ts — NetworkAwareBlockstore (S3 + network fallback)
├── blockstore-cache.ts   — Optional LRU block cache layer
├── internal-api.ts       — HTTP API endpoints (/health, /peers, /providers, etc.)
└── logger.ts             — Structured logging (Pino)

test/
├── helpers/client.js     — HTTP test client
├── health.spec.js        — Health endpoint tests
├── peers.spec.js         — Peers/connections tests
├── ping.spec.js          — Ping endpoint tests
├── providers.spec.js     — DHT provider tests
└── blocks.spec.js        — Block existence tests

docs/
├── README.md             — This file
├── NETWORK_API.md        — Full endpoint documentation
├── TESTING.md            — Testing guide
├── DOCKER_SETUP.md       — Docker deployment guide
└── ARCHITECTURE.md       — Detailed architecture
```

## Key Dependencies

- **libp2p** (v3.1.5) — P2P networking (direct, no Helia abstraction)
- **blockstore-s3** (v3) — S3-backed blockstore
- **datastore-s3** (v13) — S3-backed datastore
- **it-length-prefixed** — Bitswap protocol wire format
- **multiformats** — CID handling and hashing
- **tsx** — TypeScript execution
- **pino** — Structured logging

**No Helia dependency (v0.7+)** — Custom IPFSNode class provides direct libp2p + S3 integration

## Known Limitations & Notes

- **Bootstrap peers:** Manually configured (5 hardcoded Kubo peers by default, customisable via `BOOTSTRAP_PEERS`)
- **Peer identity:** Stored in S3 datastore; changes if S3 region/bucket changes
- **DHT timeouts:** Provider queries timeout after 15 seconds (configurable via `PROVIDERS_TIMEOUT_MS`)
- **Custom SimpleBitswap:** Uses inline protobuf codec rather than external bitswap library (for libp2p v3 compatibility)

## Troubleshooting

### "Incorrect length" on startup
- Ensure Node.js v24: `node --version`
- Verify S3 buckets exist in MinIO
- Check environment variables in `.env`

### "Connection refused" on port 3001
- Server may still be initialising (wait 5-10 seconds)
- Check `NODE_INTERNAL_PORT` in `.env`

### S3 connection errors
- Verify MinIO is running and healthy: `curl http://localhost:9000/minio/health/live`
- Check credentials match MinIO config
- Ensure `S3_ENDPOINT` doesn't include trailing slash

See [TESTING.md](TESTING.md) for more troubleshooting.

## Further Reading

- [NETWORK_API.md](NETWORK_API.md) — Complete API documentation
- [TESTING.md](TESTING.md) — Test suite guide
- [DOCKER_SETUP.md](DOCKER_SETUP.md) — Production deployment
- [CLAUDE.md](../CLAUDE.md) — Development guide
- [Helia Wiki](https://github.com/ipfs/helia/wiki) — Helia documentation
- [libp2p Docs](https://docs.libp2p.io) — libp2p reference

## License

See LICENSE file.
