# Architecture

## Custom IPFS Node (libp2p-based, v0.7+)

**This project has transitioned from Helia to a custom-built IPFSNode class** (v0.7+). The custom implementation provides direct access to libp2p + S3 storage without the Helia abstraction layer.

```typescript
// Old: Helia abstraction
import { createHelia } from 'helia'
const helia = await createHelia({ ... })

// New: Direct libp2p + S3 integration
import { createIPFSNode } from '@/ipfs-node'
const node = await createIPFSNode(blockstore, datastore)
```

### System Architecture

```
Your App (HTTP API on port 3001)
    ↓
IPFSNode (Custom class)
    ├─ libp2p instance (P2P networking)
    │  ├─ TCP transport (port 4002)
    │  ├─ WebSocket transport (port 4003)
    │  ├─ Kademlia DHT (server mode - answers inbound queries)
    │  └─ Bootstrap peer discovery (5 hardcoded Kubo peers)
    │
    ├─ SimpleBitswap (/ipfs/bitswap/1.2.0 protocol)
    │  └─ Block exchange with network peers
    │
    ├─ NetworkAwareBlockstore (fallback retrieval)
    │  ├─ Layer 1: S3Blockstore (fast local access)
    │  └─ Layer 2: Network via bitswap (on miss)
    │
    ├─ S3Datastore (metadata)
    │  └─ Pinning (stored as /local/pins/{cid})
    │
    └─ Content Routing
       └─ DHT provider announcements
           ↓
IPFS Network
```

### IPFSNode Class Structure

**File: `src/ipfs-node.ts`**

```typescript
export class IPFSNode {
  constructor(
    public readonly libp2p: Libp2p,
    public readonly blockstore: Blockstore,
    public readonly datastore: Datastore,
    public readonly bitswap: SimpleBitswap,  // Block exchange protocol
  ) {}

  // Routing via DHT
  routing = {
    provide: (cid) => this.libp2p.contentRouting.provide(cid),
    findProviders: (cid, opts?) => this.libp2p.contentRouting.findProviders(cid, opts),
  }

  // Pinning via S3 datastore
  pins = {
    add: (cid) => this.pinAdd(cid),
    rm: (cid) => this.pinRm(cid),
    ls: () => this.pinLs(),
  }

  // Lifecycle
  stop: () => this.libp2p.stop()
}
```

### Block Retrieval: SimpleBitswap Protocol

**File: `src/bitswap.ts`** (Custom implementation, ~470 lines)

This project uses a custom `SimpleBitswap` implementation compatible with libp2p v3. It replaces the now-incompatible `ipfs-bitswap` v20.0.2 which relied on deprecated libp2p registrar APIs.

**Features:**
- Standard `/ipfs/bitswap/1.2.0` protocol wire format
- Inline protobuf codec (varint encoding + length-prefixed messages)
- WantBlock requests broadcast to all connected peers
- Block responses automatically cached to S3 for fast subsequent access
- Want coalescing (duplicate requests return same promise)
- Peer topology integration (broadcasts wants to newly connected peers)

**NetworkAwareBlockstore Wrapper** (`src/blockstore-network.ts`):
- Layer 1: Check local S3 blockstore first (fast path)
- Layer 2: On miss, fetch from network via bitswap
- Layer 3: Auto-persist fetched blocks to S3 for future requests

**Message Format (Protobuf):**
```
WantBlock Request:
  field 1 (wantlist): { block=cid, priority=1, wantType=0, sendDontHave=1 }

Block Response:
  field 3 (payload): { prefix=[version|codec|hashAlg|digestLen], data=block_bytes }
```

**No external dependencies added** — uses existing `uint8arrays`, `multiformats`, `p-defer` from package.json.

### Critical: Content Promotion with .provide()

**Important:** When you add content, you must call `.provide()` to announce it on the DHT.

```typescript
const node = await createIPFSNode(blockstore, datastore)

// Add content to blockstore
const cid = CID.parse('QmXxxx...')

// Announce to DHT (optional but recommended)
await node.routing.provide(cid)
// ✓ Content is now discoverable on IPFS network
```

### Peer Discovery Flow

1. **Bootstrap** (startup): Connect to 5 hardcoded Kubo IPv4 peers
2. **Kademlia DHT** (server mode):
   - Accept inbound peer discovery queries
   - Attract peers looking for content
   - Learn about other peers from DHT operations
3. **Persistent Reconnect**: Every 30 seconds, re-dial bootstrap peers if disconnected
4. **Backup Peers**: Every hour, save discovered peers for next startup

### Comparison: Helia vs IPFSNode

| Feature | Helia | IPFSNode |
|---------|-------|----------|
| P2P Library | libp2p (abstracted) | libp2p (direct) |
| Storage | Helia blockstore wrapper | Direct S3Blockstore |
| Block Exchange | Helia bitswap wrapper | Custom SimpleBitswap |
| Routing | Helia routing interface | Direct libp2p DHT |
| Pinning | Helia pins API | Custom S3 datastore |
| Code Complexity | High abstraction | Minimal (direct libp2p) |
| Production Ready | Yes | Yes (v0.7+) |
| Node.js v24+ Required | Yes (v5+) | Yes (v3+ libp2p) |

### Why We Removed Helia

**Reasons:**
- Helia adds abstraction without significant benefit for our use case
- Direct libp2p access is simpler and more transparent
- Reduces dependency chain and future maintenance burden
- No loss of functionality (same underlying libp2p + S3 storage)

**Maintained Functionality:**
- ✓ DHT peer discovery (Kademlia)
- ✓ Content routing and announcement (.provide())
- ✓ Block exchange via bitswap (network fallback retrieval)
- ✓ P2P connectivity (TCP + WebSockets)
- ✓ S3-backed storage (blockstore + datastore)
- ✓ All REST API endpoints

### Configuration

**File: `src/libp2p-config.ts`**

Key settings:
- **Ports**: TCP 4002, WebSocket 4003 (configurable via env vars)
- **DHT**: Server mode enabled (responds to inbound queries)
- **Bootstrap**: 5 hardcoded Kubo peers + optional custom peers
- **Transports**: TCP + WebSockets (for maximum peer reachability)
- **Security**: Noise encryption + Yamux multiplexing

### API Endpoints

All on internal API (port 3001):
- `GET /health` - Node info, peer count, uptime
- `GET /peers` - List connected peer IDs
- `GET /connections` - Connection details
- `POST /ping` - Ping a peer
- `POST /connect` - Manually dial a peer
- `GET /providers/:cid` - Find who has this content
- `POST /announce` - Announce content to DHT
- `GET /blocks/:cid` - Check if block exists
- `GET /metrics` - Prometheus metrics

### Logging & Debugging

Enhanced logging shows:
- libp2p initialization steps
- Bootstrap peer connections
- DHT queries and announcements
- S3 blockstore/datastore operations

Enable debug logging:
```bash
LOG_LEVEL=debug npm run dev
```

### Testing

**Individual test suites work perfectly:**
```bash
npm run test:connect        # 11/11 passing ✓
npm run test:health          # Connectivity tests ✓
npm run test:peers           # Peer management ✓
```

**Note on parallel testing:**
The full test suite (`npm test`) requires sequential execution due to port constraints:
```bash
npm test -- --no-parallel
```

This is a test infrastructure detail, not a code issue.

---

**See Also:**
- [PEER_DISCOVERY.md](PEER_DISCOVERY.md) - libp2p discovery mechanisms
- [S3-STORAGE.md](S3-STORAGE.md) - S3 blockstore/datastore setup
- [TESTING.md](TESTING.md) - Test suite documentation
