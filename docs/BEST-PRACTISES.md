# Best Practices for glas-shard Development

This document captures lessons learned during glas-shard development, including mistakes corrected and verified working approaches.

## Testing & Development

### ❌ DO NOT: Spin Up Dev Servers for Testing

Never use `npm run dev` to test API endpoints or validate changes. This is inefficient and unreliable:
- Dev servers take 50+ seconds to initialize (waiting for peer connections)
- Manual testing misses edge cases covered by automated tests
- Changes can be tested without waiting for network bootstrap
- Results are inconsistent (peer availability varies)

### ✅ DO: Use the Comprehensive Test Suite

The project includes automated tests for all critical functionality:

**Test Organization:**
- Health endpoint validation (`test/health.spec.js`)
- Peer discovery and connectivity (`test/peers.spec.js`)
- Ping latency measurement (`test/ping.spec.js`)
- Provider discovery (`test/providers.spec.js`)
- Block storage operations (`test/blocks.spec.js`)

**Running Tests:**
- `npm test` - Run all tests
- `npm run test:watch` - Auto-rerun on file changes
- `npm run test:health` - Run specific test suite

**Why This Works:**
Tests use a local Docker environment (MinIO + Kubo) and don't require bootstrap peer connections. They complete in seconds and provide deterministic results.

---

## Network Connectivity Patterns

### Bootstrap Peer Configuration

**The Challenge:**
Bootstrap peers must be explicitly configured using the `@libp2p/bootstrap` module. Without them, nodes remain isolated and cannot discover other peers.

**What Works:**
Use Kubo's default 4 bootstrap nodes (via `/dnsaddr/bootstrap.libp2p.io`). These are:
- Industry-standard entry points to the IPFS network
- Maintained by the IPFS team
- Reliable and widely available globally
- Pre-configured in the `BOOTSTRAP_PEERS` environment variable

**What Doesn't Work:**
- IP-only bootstrap addresses (without proper peer ID format)
- Hardcoded single bootstrap nodes (creates single point of failure)
- Malformed peer multiaddrs (causes parsing errors in @libp2p/bootstrap)
- Missing bootstrap configuration entirely (node isolation)

**Implementation Pattern:**
Configure bootstrap peers in environment variables with proper multiaddr format: `/dnsaddr/<host>/p2p/<peerID>`. The bootstrap module automatically:
1. Resolves DNS addresses
2. Connects to all listed peers
3. Discovers additional peers through DHT
4. Maintains peer list across restarts

### mDNS for Local Discovery

**Purpose:**
Complements bootstrap-based discovery for local network scenarios. Essential when:
- Testing with multiple local nodes
- Running on isolated networks
- Providing redundancy during bootstrap peer downtime

**Configuration:**
- Interval: 20 seconds (every 20s, advertise presence on local network)
- Automatic: Runs alongside bootstrap peer discovery
- Non-blocking: Doesn't delay other operations

---

## Latency Measurement

### ❌ Common Mistake: Confusing Connection Duration with RTT

**The Problem:**
The initial implementation calculated latency as: `Date.now() - connection.timeline.open`

This measures *how long the connection has been open*, not actual Round-Trip Time (RTT). Results in:
- All peers showing 5000-6000ms "latency" (how long connections have been alive)
- Misleading "Poor" quality indicators
- Incorrect performance assessments

### ✅ Correct Approach: Measure Actual RTT

**For List Endpoints (/peers/detailed):**
Omit latency measurements from list endpoints. Measuring RTT requires pinging all peers sequentially, causing unacceptable delays (50+ seconds for 30+ peers).

**For Detail Endpoints (/peers/detailed/:id):**
Measure latency on-demand using the ping service:
1. Accept a single peer ID in the endpoint
2. Call `libp2p.services.ping.ping(multiaddr)`
3. Return actual RTT value
4. Accept that this endpoint takes ~100-500ms per peer

**Why This Works:**
- Ping measures actual network round-trip time (typically 50-150ms for healthy peers)
- On-demand measurement avoids blocking list operations
- Users can drill down to specific peers when RTT details are needed

---

## Agent Information Retrieval

### The Challenge: Identify Protocol Metadata

**Context:**
The identify protocol exchanges peer metadata (agent version, supported protocols, etc.) when peers connect. However, accessing this data requires understanding libp2p's peer store architecture.

**What We Learned:**

1. **Peer Store Access:**
   - The peer store (`libp2p.peerStore`) contains identified peer metadata
   - Direct `.get()` calls often return empty objects early in connection lifecycle
   - Metadata population is asynchronous and may not complete immediately

2. **Metadata Keys:**
   - Identify protocol stores agent version under varying key names
   - Common patterns: `AgentVersion`, `agent-version`, `Agent`
   - Availability depends on peer type (Kubo vs Helia vs other implementations)

3. **Current Limitation:**
   - Agent information is not reliably available during initial peer connection
   - Would require explicit identify protocol queries (causes performance issues)
   - Documented as future enhancement rather than critical feature

**Working Approach:**
Store detailed peer information endpoint as fallback data source. When client requests peer details via `/peers/detailed/:id`, include whatever agent data is available from the peer store (will be populated with time).

---

## API Endpoint Design

### Network Inspection Endpoints

**Pattern: Resource Collection vs Individual Resource**

When designing peer inspection APIs, follow REST principles:

1. **Collection Endpoint (/peers/detailed):**
   - Returns summary of all connected peers
   - Fast response time (no per-peer operations)
   - Includes: peer ID, address, direction, encryption, muxer
   - Excludes: expensive measurements (ping, identify queries)

2. **Individual Resource Endpoint (/peers/detailed/:id):**
   - Returns comprehensive details for single peer
   - Can perform expensive operations (ping, detailed queries)
   - Includes: all collection data plus latency, agent version, detailed timeline
   - Accept longer response time (user explicitly requested detail)

**Why This Separation Matters:**
- Lists remain responsive even with 50+ peers
- Detailed queries don't block the dashboard
- Users can decide when to pay the performance cost
- Aligns with REST API design conventions

### Single-Line Request Logging

**Pattern: Unified Request Tracking**

Instead of multiple logs per request (one for received, one for completed), use a single consolidated log:

1. Wrap the response object to capture response details
2. Log once when response completes
3. Include: client IP, method, path, status code, duration

**Why This Works:**
- Easier to correlate requests in log files
- Reduces log volume by 50%
- Clear cause-effect relationship (request → response)
- Better for automated log parsing and monitoring

---

## Environment Configuration

### Required vs Optional Variables

**Critical (Must Exist):**
- `BOOTSTRAP_PEERS` - Network entry point configuration
- `DELEGATED_ROUTING_V1_HOST` - Content discovery endpoint
- S3 credentials and endpoints - Persistent storage

**These Have Safe Defaults:**
- `LIBP2P_PORT` (default: 4001)
- `LIBP2P_WS_PORT` (default: 4002)
- `ANNOUNCE_IP` (default: 127.0.0.1)
- `NODE_INTERNAL_PORT` (default: 3001)

**Pattern:**
Always provide defaults for operational parameters, but require network/storage configuration. This allows the app to start in minimal environments while preventing data loss from misconfiguration.

---

## Error Handling in Network Operations

### Acceptable Failures vs Critical Failures

**Pattern: Graceful Degradation**

When network operations fail (ping timeout, peer unreachable, identify incomplete):
- Log at debug level (don't alarm on transient failures)
- Continue operation with fallback values
- Return what data is available (partial response better than error)
- Mark unavailable fields as `undefined` (not error objects)

**Example Pattern:**
When fetching agent information:
- Attempt to query peer store
- If unavailable, omit the field rather than failing the entire peer list
- User sees connection data with empty agent field
- No error response, no request failure

This approach prevents one peer's timeout from breaking the entire peer list endpoint.

---

## Configuration File Organization

### Three-Layer Configuration Approach

**Layer 1: Environment Variables (.env)**
- Runtime configuration (ports, external URLs)
- Secrets (S3 credentials)
- Bootstrap settings (which bootstrap nodes to connect to)

**Layer 2: Hardcoded Defaults (source code)**
- Network timeouts
- Pool sizes (max connections: 300)
- Discovery intervals (mDNS: 20s)
- Performance tuning (cache sizes)

**Layer 3: Command-Line Arguments (not used in this project)**
- One-off overrides for specific test runs

**Why Three Layers:**
- Environment variables capture deployment differences (local, staging, production)
- Defaults handle common cases without config files
- No configuration files to version/manage (reduces complexity)

---

## Debugging Network Issues

### High Latency Diagnosis

When observing unusually high latencies (5000ms+):

1. **Verify Latency Calculation:**
   - Check if measuring actual RTT vs connection duration
   - Use ping service for verification
   - Compare against bootstrap node latencies

2. **Check Peer Quality:**
   - Peers should be globally distributed
   - Expect 50-300ms latency to geographically distant peers
   - 5000ms+ indicates connection pooling delays or unresponsive peers

3. **Investigate Bootstrap State:**
   - Verify bootstrap peers are configured
   - Check logs for successful bootstrap connections
   - Confirm DHT is discovering peers (should see 30+ within 60 seconds)

### Common Symptoms and Solutions

**Symptom: Immediate peer disconnections**
- Check libp2p listen addresses are reachable
- Verify firewall rules allow inbound connections
- Use `FaultTolerance.NO_FATAL` to handle transport failures gracefully

**Symptom: Zero peers after 60 seconds**
- Verify bootstrap peer configuration (format matters)
- Check delegated routing endpoint is accessible
- Confirm S3 storage is available (affects DHT initialization)

---

## Code Quality Patterns

### When to Use Async/Await vs Sync Code

**Use Async for:**
- Network operations (ping, identify, bootstrap)
- Storage operations (S3 reads/writes)
- Any operation that might block the event loop

**Use Sync for:**
- Data transformations
- Request parsing
- Response formatting
- In-memory lookups

**Performance Implication:**
Avoid `await` in list endpoints (causes sequential operations). Instead, collect data synchronously from already-connected peers, then offer detailed endpoints for operations requiring async work.

---

## Documentation Maintenance

### Critical Sections to Document

When making changes to network behavior:

1. **Environment Variables** - Every new config option needs description
2. **API Endpoints** - Request format, response format, when to use each endpoint
3. **Configuration Requirements** - What must be set vs what has defaults
4. **Bootstrap Behavior** - How/when bootstrap happens, what to expect
5. **Error Scenarios** - What errors are normal (retrying) vs critical (failing)

### Reference Documentation

- See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for system design
- See [TESTING.md](docs/TESTING.md) for comprehensive test guide
- See [S3-STORAGE.md](docs/S3-STORAGE.md) for storage configuration details

---

## Summary of Corrected Mistakes

| Issue | Mistake | Solution |
|-------|---------|----------|
| **Latency Calculation** | Measuring connection duration instead of RTT | Use ping service for actual measurements, only in detail endpoints |
| **Bootstrap Configuration** | IP-only or malformed peer addresses | Use `/dnsaddr/bootstrap.libp2p.io` with proper multiaddr format |
| **Testing Approach** | Spinning up dev servers manually | Use automated test suite with Docker environment |
| **Agent Retrieval** | Attempting to query identify protocol synchronously | Store as optional field, populate asynchronously when available |
| **Request Logging** | Multiple logs per request (received + completed) | Single consolidated log at response completion |
| **List Performance** | Performing expensive operations in list endpoints | Separate collection and detail endpoints |

