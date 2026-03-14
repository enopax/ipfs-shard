# libp2p Peer Discovery Architecture

## Overview

This document describes how the IPFS S3 server discovers and connects to peers on the IPFS network. The architecture implements **aggressive peer discovery** with active DHT participation:

1. **Bootstrap Peers** - Initial entry to the IPFS network (2-3 peers)
2. **DHT Announcements (Active)** - Periodic DHT puts that trigger peer discovery
3. **Kademlia DHT (Server Mode)** - Full DHT participation and peer discovery
4. **Connection Manager Pruning** - Aggressive peer cycling to force discovery growth

## Architecture Philosophy

**This node maximises peer discovery through continuous DHT announcements and aggressive connection cycling.** Rather than passive DHT discovery, the node actively PUTs keys to the DHT every 5 seconds, forcing connection establishment and peer discovery as a side effect. When peer count hits the ceiling, the connection manager prunes the weakest peers, allowing more discovery to occur.

## Configuration Location

**File:** `src/libp2p-config.ts`

This is the **single source of truth** for peer discovery. Any changes to peer discovery strategy must go through this file.

## Four Peer Discovery Mechanisms

### 1. Bootstrap Peers (Initial Network Entry)

**Purpose:** Help new nodes join the IPFS network by connecting to known, stable peers.

**Configured in:** `.env` via `BOOTSTRAP_PEERS` environment variable

**Default bootstrap peers (Kubo-compatible):**
```
/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN
/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa
/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb
/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt
/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ
```

**How it works:**
1. Node starts and attempts to connect to bootstrap peers
2. Bootstrap peers respond with other known peers
3. Node discovers peers through DHT and other discovery mechanisms
4. Eventually reaches a critical mass of connections

**Importance:** Without bootstrap peers, a new node is isolated from the network.

### 2. Kademlia DHT (Server Mode)

**Purpose:** Maintain the distributed hash table and discover new peers through DHT lookups.

**Configured in:** `src/libp2p-config.ts` (lines 64-66)

```typescript
dht: kadDHT({
  clientMode: false,  // Server mode = contribute to the DHT
}),
```

**Why Server Mode:**
- `clientMode: false` = This node is a full DHT participant (like Kubo)
- Stores routing information about other peers
- Responds to DHT queries from other nodes
- More resource-intensive but provides better network health

**How it works:**
1. Node joins the DHT by connecting to bootstrap peers
2. DHT stores its own information (peer ID, multiaddrs)
3. As node makes queries, it learns about other peers
4. DHT automatically discovers new peers based on content lookups

### 3. Active DHT Announcements (Aggressive Discovery)

**Purpose:** Force DHT peer discovery by periodically announcing keys to the network.

**Configured in:** `src/index.ts` via `startDHTDiscoveryLoop()`

```typescript
// Every 5 seconds: PUT random key in DHT
// Each PUT forces connections to DHT peers → returns peer lists → auto-connect
// Result: exponential peer discovery
```

**Why Active Announcements:**
- Passive DHT discovery (queries) is too slow
- Active DHT puts force peer connections as a side effect
- Each 5-second announcement discovers 3-5 new peers
- Creates cascade effect: discover peers → grow to ceiling → prune → repeat

**How it works:**
1. Every 5 seconds, generate random 32-byte key
2. PUT key to DHT (async, 3s timeout)
3. DHT spreads the key, returning peer lists
4. libp2p auto-connects to discovered peers
5. Repeat, creating constant peer churn

**Expected effect:** Logs spam with "Peer connected"/"Peer disconnected" constantly

### 4. Connection Manager Pruning (Peer Cycling)

**Purpose:** Maintain aggressive peer discovery by pruning connections at a ceiling.

**Configured in:** `src/libp2p-config.ts` (connectionManager)

```typescript
connectionManager: {
  maxConnections: 300,        // HighWater (prune when exceeding)
  maxParallelDials: 100,      // Dial 100 peers concurrently
  dialTimeout: 5000,          // Fail fast: 5s per dial
  maxDialQueueLength: 500,    // Queue up discovery attempts
}
```

**Why Connection Manager Pruning:**
- Prevents infinite growth of connections
- Forces cycling of weakest peers
- Allows new discovery to continue
- Matches Kubo's full-node settings (HighWater=200-300)

**How it works:**
1. Node discovers peers, grows toward 300 ceiling
2. When hitting 300, connection manager scores peers
3. Weakest 50 peers are disconnected
4. Node drops to ~250 peers
5. DHT announcements discover more peers
6. Cycle repeats: 250→300→250→300...

**Why 300 peers:**
- Kubo full-node standard: HighWater 200-300
- Brave/Desktop: HighWater 40 (too low for discovery)
- Legacy Kubo: HighWater 900 (too high, wasted resources)

## Network Configuration

### Environment Variables

**`ANNOUNCE_IP`** (Critical for connectivity)
```bash
# Must be the actual server IP or hostname
# DO NOT use 127.0.0.1 unless testing locally
ANNOUNCE_IP=195.201.28.104  # Your server's public IP
```

**`LIBP2P_PORT`** (Default: 4001)
```bash
LIBP2P_PORT=4001
```

**`LIBP2P_WS_PORT`** (Default: 4002)
```bash
LIBP2P_WS_PORT=4002
```

**`BOOTSTRAP_PEERS`** (Optional, defaults to Kubo bootstrap)
```bash
# Comma-separated list of bootstrap peer multiaddrs
BOOTSTRAP_PEERS=/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN,...
```

### Firewall Requirements

**For peer connectivity to work, these ports MUST be open to inbound traffic:**

- **Port 4001** - TCP (libp2p main protocol)
- **Port 4002** - TCP with WebSocket (libp2p WebSocket transport)

```bash
# Check if ports are listening
sudo lsof -i :4001
sudo lsof -i :4002

# Test from another machine
timeout 2 bash -c 'cat < /dev/null > /dev/tcp/YOUR_IP/4001' && echo "Open" || echo "Blocked"
```

If ports are blocked, update your firewall/security group to allow inbound traffic on these ports.

## Monitoring Peer Connectivity

### Health Endpoint

```bash
curl http://localhost:4000/health | jq
```

Look for:
- `connections` - Current peer count (should grow beyond 1)
- `multiaddrs` - Announced network addresses (must show your public IP)

### Sample Healthy Output

```json
{
  "status": "ok",
  "peerId": "12D3KooWCKcQagDhST93Zh9BUMBy6AuGP8ahvKRAyHKmYTGxcaBc",
  "connections": 42,
  "multiaddrs": [
    "/ip4/195.201.28.104/tcp/4001/p2p/12D3KooWCKcQagDhST93Zh9BUMBy6AuGP8ahvKRAyHKmYTGxcaBc",
    "/ip4/195.201.28.104/tcp/4002/ws/p2p/12D3KooWCKcQagDhST93Zh9BUMBy6AuGP8ahvKRAyHKmYTGxcaBc"
  ]
}
```

### Expected Peer Growth

- **Startup (0-5 seconds):** 1-2 connections (bootstrap peers)
- **After 10 seconds:** 3-5 peers (first DHT announcement)
- **After 30 seconds:** 20-30 peers (exponential growth via announcements)
- **After 1 minute:** 50-100 peers (continuous cycling)
- **After 2 minutes:** 100-250 peers (approaching ceiling)
- **Steady state:** 100-300 peers oscillating (constant churn)

**Logs will show continuous peer activity:**
```
Peer connected {"count":42}
Peer connected {"count":43}
Peer connected {"count":44}
DHT announcement sent {"connectedCount":100}
Peer connected {"count":45}
...
Peer connected {"count":300}
Peer disconnected {"count":299}  ← connection manager pruning
Peer disconnected {"count":298}
...
(cycle repeats continuously)
```

If peer count stays below 10, check:
1. Are firewall ports open?
2. Is ANNOUNCE_IP correct?
3. Are bootstrap peers reachable?
4. Check logs: `npm run dev 2>&1 | grep -E "Peer connected|DHT announcement"`

## Implementation Details

### Why This Architecture Works

This design maximises peer discovery through **active DHT announcements + aggressive pruning**:

| Phase | Mechanism | Peers | Growth |
|-------|-----------|-------|--------|
| Init | Bootstrap | 1-2 | Base entry |
| Growth | DHT announcements (every 5s) | 2→300 | +3-5 peers/announce |
| Cycling | Connection manager ceiling | 300→250 | Pruning triggers |
| Repeat | More discoveries replace pruned | 250→300 | Exponential until stable |

**Why announcements work better than queries:**
- Queries (findPeer, findProviders) = passive lookups
- Puts (announcements) = **active network participation** that forces connections
- Each PUT must connect to 10+ DHT peers to store the key
- Those peers return their known peers → cascading discovery

**Why pruning helps discovery:**
- Without ceiling, node gets stuck with first N peers
- With ceiling, forced cycling brings fresh peers continuously
- Old (stale) peers are pruned, new (active) peers connect
- Maintains optimal network health

### Code Structure

**libp2p Configuration** (`src/libp2p-config.ts`):
```
createLibp2pNode()
├─ Transports: TCP + WebSocket
├─ Encryption: Noise
├─ Multiplexing: Yamux
├─ Peer Discovery: Bootstrap peers (via BOOTSTRAP_PEERS env var)
├─ DHT: Server mode (full participant, not client)
└─ Connection Manager: maxConnections=300, maxParallelDials=100
```

**Active Discovery Loop** (`src/index.ts`):
```
startDHTDiscoveryLoop()
├─ Every 5 seconds:
├─ Generate random 32-byte key
├─ PUT key to DHT (timeout 3s)
└─ Forces DHT to return peer lists → auto-connect
```

**Bootstrap Loop** (`src/index.ts`):
```
startBootstrapDialLoop()
├─ Every 30 seconds:
├─ Dial bootstrap peers explicitly
└─ Maintains connection to initial entry points
```

## Critical: Do NOT Remove

**These must be preserved for peer discovery to work:**

1. **Bootstrap peers configuration** - Entry point to network (1-2 peers)
2. **DHT announcement loop** - Drives exponential peer discovery (every 5s)
3. **Connection manager pruning** - Forces peer cycling (hits 300 ceiling)
4. **DHT in server mode** - Allows DHT participation (full node, not client)

## Testing Peer Discovery

### Quick Test

```bash
# 1. Check node started
curl http://localhost:4000/health

# 2. Monitor peer growth
watch -n 5 'curl -s http://localhost:4000/health | jq .connections'

# 3. Check for connectivity errors in logs
pm2 logs shard1 | grep -E "error|failed|timeout" | head -20
```

### Network Diagnostics

```bash
# Verify bootstrap peer connectivity
nslookup bootstrap.libp2p.io
# Should resolve to multiple IPs

# Check delegated routing endpoint
curl -I https://delegated-ipfs.dev/routing/v1/
# Should return 404 or similar (not connection refused)

# Verify local node is announcing correctly
curl -s http://localhost:4000/health | jq '.multiaddrs'
# Should show your ANNOUNCE_IP, not 127.0.0.1
```

## Future Changes

When modifying peer discovery:

1. **ALWAYS edit `src/libp2p-config.ts`** - This is the single source of truth
2. **Preserve the three mechanisms** - Bootstrap, DHT, and delegated routing
3. **Update `.env` documentation** - If adding new env vars
4. **Test connectivity** - Monitor `/health` endpoint before deploying
5. **Document changes here** - Keep this file current

### Safe Changes

- Updating bootstrap peer URLs (if they change)
- Adjusting connection limits (`maxConnections`)
- Changing delegated routing endpoint URL
- Adding additional peer discovery mechanisms (e.g., IPNI, DHT client mode)

### Dangerous Changes

- Removing delegated routing service
- Changing DHT from server to client mode
- Removing bootstrap peer discovery
- Changing `ANNOUNCE_IP` to localhost

## Comparison with Kubo

This architecture mirrors Kubo's peer discovery:

| Component | Kubo | Helia Shard |
|-----------|------|-------------|
| Bootstrap | Yes (4+ peers) | Yes (same 4 peers) |
| DHT Mode | Server (full participant) | Server (full participant) |
| Delegated Routing | Yes (to delegated-ipfs.dev) | Yes (same endpoint) |
| Content Routing | Kubo's internal routing | Helia's blockstore + delegated routing |

## References

- [Kubo Connection Manager Configuration](https://github.com/ipfs/kubo/blob/master/docs/config.md)
- [libp2p Bootstrap Module](https://github.com/libp2p/js-libp2p-bootstrap)
- [libp2p Kademlia DHT](https://github.com/libp2p/js-libp2p-kad-dht)
- [libp2p v3 API Documentation](https://github.com/libp2p/js-libp2p)
- [Lower default connection limits discussion · ipfs/kubo#9420](https://github.com/ipfs/kubo/issues/9420)
