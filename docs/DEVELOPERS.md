# Developer Guide

This guide is for developers who want to understand, extend, or contribute to ipfs-shard.

## Prerequisites

- **Node.js v24+** (`node --version`)
- **npm 11+** (comes with Node.js)
- **Docker & Docker Compose** (for local S3 testing)
- **Basic understanding of IPFS and libp2p** (see [Further Reading](#further-reading))

## Project Setup

### 1. Clone and Install

```bash
git clone https://github.com/yourusername/ipfs-shard.git
cd ipfs-shard
npm install
```

### 2. Start S3 Backend (MinIO)

```bash
# Start MinIO container
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  --name minio-server \
  minio/minio server /data --console-address ":9001"

# Create required buckets
docker exec minio-server mkdir -p /data/glashaus-blocks /data/glashaus-data

# Or using mc CLI:
# mc alias set local http://localhost:9000 minioadmin minioadmin
# mc mb local/glashaus-blocks --ignore-existing
# mc mb local/glashaus-data --ignore-existing

# Access MinIO console at http://localhost:9001 (minioadmin:minioadmin)
```

### 3. Configure Environment

```bash
cp .env.example .env
# Edit .env as needed (defaults work for local development)
```

### 4. Run Development Server

```bash
npm run dev
```

Server starts on http://localhost:4000. Nodemon watches for file changes.

### 5. Run Tests

```bash
npm test              # All tests
npm run test:watch   # Watch mode
npm run test:health  # Single suite
```

## Code Structure

### Entry Point: `src/index.ts`

```typescript
// 1. Load environment variables
// 2. Initialize S3 client
// 3. Create blockstore & datastore
// 4. Create IPFSNode instance
// 5. Wrap blockstore with network fallback & cache
// 6. Start internal API server
// 7. Start bitswap & reprovide loops
```

### Core Classes

#### `src/ipfs-node.ts` — IPFSNode

The heart of the system. Combines libp2p, storage, and content routing.

```typescript
class IPFSNode {
  // libp2p instance (P2P networking)
  libp2p: Libp2p

  // Bitswap protocol handler (block exchange)
  bitswap: SimpleBitswap

  // Pinning management
  pins: PinManager

  // Content routing to DHT
  contentRouting: ContentRouting

  // Lifecycle
  async start()
  async stop()
}
```

Key methods:
- `start()` — Initialize libp2p, bitswap, DHT, bootstrap peers
- `stop()` — Graceful shutdown, cleanup streams
- Internal methods for pinning, content routing, DHT announcements

#### `src/libp2p-config.ts` — libp2p Configuration

Factory function that creates a libp2p node with proper configuration.

```typescript
function createLibp2pNode(
  blockstore: Blockstore,
  datastore: Datastore,
  options: Libp2pOptions
): Promise<Libp2p>
```

Configures:
- **Transports:** TCP, WebSocket (browser compatible)
- **Encryption:** Noise protocol
- **Multiplexing:** Yamux
- **DHT:** Kademlia (server mode — answers queries)
- **Bootstrap:** Default Kubo peers or custom
- **Services:** Identify, Ping

#### `src/bitswap.ts` — SimpleBitswap

Custom bitswap implementation for libp2p v3 compatibility.

```typescript
class SimpleBitswap {
  // Request a block from peers
  want(cid: CID, opts?: { signal?: AbortSignal }): Promise<Uint8Array>

  // Lifecycle
  start(): Promise<void>
  stop(): Promise<void>
}
```

Architecture:
- **Stream Pool:** Persistent bidirectional streams per peer
- **Unified Read Loop:** Handles both outbound and inbound messages
- **Auto-serving:** When peer wants a block, serve it on same stream
- **Want Coalescing:** Duplicate requests return same promise

Key details:
- Supports bitswap 1.0.0, 1.1.0, 1.2.0 (negotiates highest)
- Uses inline protobuf encoding (no external deps)
- Automatic stream cleanup on error

#### `src/blockstore-network.ts` — NetworkAwareBlockstore

Intelligent block retrieval with fallback chain.

```typescript
class NetworkAwareBlockstore extends BaseBlockstore {
  async *get(cid: CID): AsyncGenerator<Uint8Array>
}
```

Retrieval chain:
1. **Local S3** — Fast local access
2. **Bitswap** — Broadcast to peers (5s timeout)
3. **DHT** — Query providers, dial, retry (5s timeout)
4. **IPNI** — InterPlanetary Network Indexer (5s timeout)
5. **Gateway** — Public IPFS gateway (fallback)

Each step has error handling and timeout protection.

#### `src/internal-api.ts` — HTTP API

Express.js server with endpoints for:
- Health checks
- Peer queries
- Block lookups
- Content announcements
- Metrics

Each endpoint:
- Validates input
- Handles errors gracefully
- Logs with context
- Returns JSON with proper status codes

### Supporting Modules

- **`src/metrics.ts`** — Prometheus metrics collection
- **`src/logger.ts`** — Structured logging with pino
- **`src/reprovide.ts`** — DHT re-provide loop (24h refresh)
- **`src/blockstore-cache.ts`** — Optional LRU cache layer

## Key Concepts

### Content Routing (DHT Announcements)

When content is pinned, it's announced to DHT peers:

```typescript
// In ipfs-node.ts
await node.contentRouting.provide(cid)

// Other peers can find it:
const providers = await dht.findProviders(cid)
```

DHT records expire after 24 hours, so `reprovide.ts` re-announces every 22 hours.

### Block Retrieval Strategy

The `NetworkAwareBlockstore` implements intelligent fallback:

```
User requests block
  ↓
1. Try local S3 (fast path)
  ↓ (if miss)
2. Broadcast want to connected peers (bitswap)
  ↓ (if timeout)
3. Query DHT for providers, dial them
  ↓ (if no providers)
4. Query IPNI (global content index)
  ↓ (if not found)
5. Fallback to public gateway
  ↓
Return block or 404 error
```

### Error Handling Patterns

**Network errors are expected and handled gracefully:**

```typescript
// Example: Dial a peer
try {
  await libp2p.dial(multiaddr)
} catch (err) {
  // Log and continue with next address
  logger.debug({ addr: multiaddr.toString(), error: String(err) })
}
```

**S3 errors map to IPFS errors:**

```typescript
// In ipfs-node.ts, the S3Datastore error wrapper converts:
// S3: NoSuchKey → IPFS: NotFoundError
// This ensures libp2p peer-store works correctly
```

## Testing Patterns

### Test Structure

```typescript
import test from 'node:test'
import assert from 'node:assert/strict'

test('description', async (t) => {
  // Setup
  const node = await createTestNode()

  try {
    // Test
    const result = await node.method()
    assert.equal(result, expected)
  } finally {
    // Cleanup
    await node.stop()
  }
})
```

### Test Helpers

**Server setup** (`test/helpers/server.js`):
- Global setup: starts test server once
- Reference counting: stops when all tests done
- Automatic cleanup

**HTTP client** (`test/helpers/client.js`):
- Utility for making API requests
- Error handling
- Response validation

### Writing Tests

1. **Unit tests** — Test individual functions (no network)
2. **Integration tests** — Test with real peers/DHT
3. **E2E tests** — Test full flow (slow, optional)

```bash
# Run all tests
npm test

# Run specific suite
npm run test:health

# Watch mode (reruns on file changes)
npm run test:watch
```

## Common Tasks

### Adding an API Endpoint

1. **Add handler in `src/internal-api.ts`:**

```typescript
app.get('/custom-endpoint/:id', async (req, res) => {
  try {
    const result = await processRequest(req.params.id)
    res.json({ success: true, result })
  } catch (err) {
    logger.error({ error: String(err) }, 'Endpoint error')
    res.status(500).json({ error: String(err) })
  }
})
```

2. **Add tests in `test/`:**

```typescript
test('GET /custom-endpoint/:id returns 200', async (t) => {
  const res = await fetch('http://localhost:4000/custom-endpoint/test-id')
  assert.equal(res.status, 200)
})
```

3. **Document in `docs/ARCHITECTURE.md`**

### Improving Block Retrieval

1. **Modify `src/blockstore-network.ts`**
2. **Update retrieval chain in `get()` method**
3. **Add tests to verify each tier works**
4. **Update docs/ARCHITECTURE.md with new flow**

### Debugging Network Issues

Enable debug logging:

```bash
LOG_LEVEL=debug npm run dev
```

Monitor peer connections:

```bash
curl http://localhost:4000/peers  # List peer IDs
curl http://localhost:4000/connections  # Detailed connection info
```

Check DHT status:

```bash
curl http://localhost:4000/health  # Check dhtMode and connections
```

## Performance Optimization

### Monitoring

View Prometheus metrics:

```bash
curl http://localhost:4000/metrics
```

Key metrics:
- `http_requests_total` — API request count
- `http_request_duration_seconds` — Latency
- `ipfs_blocks_retrieved_total` — Block retrieval count
- `ipfs_blocks_retrieved_duration_seconds` — Block fetch time
- `ipfs_connected_peers` — Current peer count

### Caching

Enable LRU block cache:

```bash
BLOCK_CACHE_MB=512 npm run dev
```

This caches recently accessed blocks in memory for faster retrieval.

### Timeouts

Tune retrieval timeouts:

```bash
BITSWAP_WANT_TIMEOUT_MS=5000 npm run dev
DHT_PROVIDER_TIMEOUT_MS=5000 npm run dev
```

Lower values = faster failure detection (but more errors with slow networks)

## Common Errors & Solutions

### "NoSuchKey" Error

**Problem:** S3 blockstore throws NoSuchKey instead of NotFoundError

**Solution:** The S3Datastore error wrapper in `src/ipfs-node.ts` converts this. Don't remove it!

### "UnsupportedProtocolError"

**Problem:** Can't dial peer with bitswap protocol

**Normal!** Some peers don't support all bitswap versions. The node will:
1. Try all supported versions
2. Retry with other peers
3. Fall back to DHT/IPNI/gateway

### "Connection timeout"

**Problem:** Peer connection hangs

**Solution:**
- Check firewall/network
- Verify bootstrap peers are reachable
- Check peer ID format (should start with 12D3Koo)

### "DHT not ready"

**Problem:** Provider queries fail immediately

**Solution:** Wait for DHT to warm up (5-10 seconds). Check logs:

```bash
LOG_LEVEL=debug npm run dev | grep DHT
```

## Further Reading

### IPFS & libp2p Specifications
- [IPFS Specs](https://specs.ipfs.tech) — Protocol specifications
- [libp2p Docs](https://docs.libp2p.io) — P2P networking framework
- [Bitswap Spec](https://specs.ipfs.tech/bitswap/) — Block exchange protocol
- [IPFS DHT](https://docs.ipfs.tech/concepts/dht/) — Distributed Hash Table

### Project Documentation
- [ARCHITECTURE.md](ARCHITECTURE.md) — System design
- [PEER_DISCOVERY.md](PEER_DISCOVERY.md) — Peer discovery & DHT
- [BEST-PRACTISES.md](BEST-PRACTISES.md) — Development patterns
- [TESTING.md](TESTING.md) — Test suite guide

### Related Projects
- [Kubo](https://github.com/ipfs/kubo) — Reference IPFS implementation
- [helia](https://github.com/ipfs/helia) — IPFS library for JavaScript
- [libp2p-js](https://github.com/libp2p/js-libp2p) — JavaScript implementation

## Getting Help

- Check [docs/](docs/) directory first
- Search [GitHub Issues](https://github.com/yourusername/ipfs-shard/issues)
- Open a [GitHub Discussion](https://github.com/yourusername/ipfs-shard/discussions)
- Review [CLAUDE.md](../CLAUDE.md) for project context

---

Happy developing! 🚀
