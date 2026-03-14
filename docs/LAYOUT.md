# API Modular Structure & MCP Pattern

This document describes the modular architecture of the IPFS Shard API and the Model Context Protocol (MCP) pattern used to organise route handlers.

## Overview

The internal API (port 3001) uses a **modular, domain-driven structure** inspired by the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server architecture. Instead of a monolithic 1375-line request handler, each API domain gets its own focused module.

**Reference:** The MCP pattern structures tools and resources in separate files within `tools/` and `resources/` folders, each exporting focused handlers assembled by a thin entry point. We apply the same principle to HTTP routes.

## Directory Structure

```
src/
├── api/                       ← API route modules
│   ├── http-router.ts        ← Router dispatcher: createApiRouter() (URL matching & routing)
│   ├── helpers.ts            ← Shared utilities (path normalisation, parsing, DAG codecs)
│   ├── ui.ts                 ← GET / (HTML dashboard) — handleUi()
│   ├── metrics.ts            ← GET /metrics (Prometheus) — handleMetrics()
│   ├── health.ts             ← GET /health — handleHealth()
│   ├── peers.ts              ← GET /peers, /peers/detailed, /peers/detailed/:peerId — handlePeers()
│   ├── connections.ts        ← GET /connections, POST /connect, POST /ping — handleConnections()
│   ├── pins.ts               ← GET /pins, POST /pin, DELETE /pin — handlePins()
│   ├── blocks.ts             ← GET /blocks/:cid, /cat/:cid, /ls/:cid — handleBlocks()
│   ├── dht.ts                ← GET /providers/:cid, /dht/status/:cid, POST /announce, POST /providers — handleDht()
│   └── stats.ts              ← GET /stats, POST /dag/stat, POST /block/stat — handleStats()
├── internal-api.ts           ← Thin Express shell (Express middleware + router mount)
├── index.ts                  ← App entry point (named setup functions, graceful shutdown)
├── ipfs-node.ts              ← IPFSNode class (core IPFS logic, untouched)
├── metrics.ts                ← Prometheus metrics (untouched)
├── reprovide.ts              ← DHT re-provide loop (untouched)
└── ... [other modules]
```

## Convention: Handler Function Pattern

Each route module exports one or more handler functions following the pattern:

```typescript
import http from 'http'
import type { RouteContext } from './http-router.js'

export async function handle<Domain>(
  ctx: RouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  action?: string
): Promise<boolean> {
  // Route logic
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
  return true  // true = route handled, false = continue to next route
}
```

**Why this pattern:**
- Works directly with Node.js `http` module (no framework dependency)
- Each handler is pure (takes context, req/res, returns boolean)
- Matches MCP's tool/resource handler pattern
- Scales: add a new domain by exporting a new `handle*` function
- Testable: handlers can be unit-tested with mock objects

## RouteContext

All route handlers receive a `RouteContext` containing:

```typescript
interface RouteContext {
  node: IPFSNode           // The custom IPFS node runtime
  blockstore: Blockstore   // S3 or LRU-wrapped blockstore
  version: string          // Package version for /health response
  checkS3Health?: () => Promise<boolean>  // Optional S3 health check
}
```

This context is passed to every route module's `register*` function, ensuring all handlers have access to the same node, blockstore, and S3 health check closure.

## Entry Points

### `src/api/http-router.ts` — Router Dispatcher

~140 lines:

```typescript
export async function createApiRouter(
  ctx: RouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  const method = req.method || ''
  const url = req.url || '/'

  // Pattern match and dispatch to handlers
  if (method === 'GET' && url === '/health') return await handleHealth(ctx, req, res)
  if (method === 'GET' && url.match(/^\/providers\/[^/?]+$/)) return await handleDht(ctx, req, res, 'providers-get')
  // ... etc

  return false  // Not matched
}
```

Performs URL pattern matching (regex-based) and dispatches to the appropriate handler. Each handler returns `true` if it handled the request, `false` if it should fall through to 404.

### `src/internal-api.ts` — Thin HTTP Shell

~80 lines (vs. 1375 before):

- Creates `http.Server` directly (no framework dependency)
- Wraps request/response for logging and metrics
- Calls `createApiRouter(ctx, req, res)` to dispatch request
- Returns 404 if no route matched
- Catches and logs errors
- No route logic — all delegated to `src/api/*` handlers

### `src/index.ts` — Named Setup Functions

Extracted three setup phases into named functions:

```typescript
async function setupStorage(): Promise<{ s3Client, rawBlockstore, datastore }>
async function setupIPFSNode(rawBlockstore, datastore): Promise<{ node, blockstore }>
function startBackgroundLoops(node, datastore, bootstrapMultiaddrs): Array<() => void>
```

Main flow:
1. Validate environment
2. `setupStorage()` — create S3/memory blockstore and datastore
3. `setupIPFSNode()` — wrap with LRU cache, network fallback
4. Peer discovery event listeners
5. Wait for peer connections (if not in memory mode)
6. `startInternalAPI()` — start Express server
7. `startBackgroundLoops()` — start bootstrap, DHT, reprovide loops
8. Log startup info
9. Graceful shutdown on SIGTERM/SIGINT

## Adding New Routes

When adding a new API endpoint:

### 1. Create a new file in `src/api/new-domain.ts`

```typescript
import http from 'http'
import type { RouteContext } from './http-router.js'

export async function handleNewDomain(
  ctx: RouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  action?: string
): Promise<boolean> {
  // Use ctx.node, ctx.blockstore, ctx.version, etc.
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ ok: true }))
  return true  // Tell router: "I handled this request"
}
```

### 2. Add URL matching in `src/api/http-router.ts`

```typescript
import { handleNewDomain } from './new-domain.js'

export async function createApiRouter(
  ctx: RouteContext,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  // ... existing routes ...

  if (method === 'GET' && urlWithoutQuery === '/new-endpoint') {
    return await handleNewDomain(ctx, req, res)
  }

  return false  // No route matched
}
```

### 3. Use shared helpers if needed

```typescript
import { parseJsonBody, normalisePath, getQueryParam, decodeDagPB } from './helpers.js'
```

## Shared Utilities (`src/api/helpers.ts`)

Extracted to avoid duplication:

- `normalisePath(path)` — collapses dynamic CID segments for metrics (e.g., `/providers/Qm...` → `/providers/:cid`)
- `parseJsonBody(req)` — parse JSON request body
- `getClientIp(req)` — extract client IP from headers or socket
- `getQueryParam(urlStr, paramName)` — parse query parameters
- `readVarint()`, `decodeDagPB()`, `unixFSType()` — protobuf DAG-PB codec helpers

## MCP Inspiration

The MCP (Model Context Protocol) server architecture uses a thin dispatcher that routes requests to focused handlers:

```typescript
// MCP pattern (reference)
if (request.type === 'call_tool') {
  const tool = tools[request.name]
  return await tool.execute(request.input)
}
```

We apply the same principle to HTTP routing:

```typescript
// Our pattern in http-router.ts
if (method === 'GET' && url === '/health') {
  return await handleHealth(ctx, req, res)
}
if (method === 'POST' && url === '/pin') {
  return await handlePins(ctx, req, res, 'add')
}
// ... each handler returns true/false to indicate "handled" or "continue"
```

Benefits:
- **Separation of concerns** — each domain is self-contained in its own file
- **Scalability** — adding a new API domain doesn't require modifying other files (except http-router.ts for URL matching)
- **Testability** — handlers are pure functions (no framework coupling)
- **Maintainability** — route files are focused and readable (not 1375 lines in one file)
- **Framework-agnostic** — uses only Node.js `http` module (no Express dependency)

## Metrics & Logging

All HTTP requests are logged via middleware in `src/internal-api.ts`:

```typescript
logger.info({
  clientIp,
  method,
  path,
  statusCode,
  durationMs,
}, 'API request')
```

Prometheus metrics recorded:
- `http_requests_total` — request count by method, path, status
- `http_request_duration_seconds` — request latency histogram

Routes can also emit custom metrics (e.g., `blockRetrieveCounter`, `pinsTotalGauge`) defined in `src/metrics.ts`.

## Migration Notes

**What changed:**
- ✅ Modular route files (`src/api/`)
- ✅ Thin `src/internal-api.ts` using Express
- ✅ Named setup functions in `src/index.ts`

**What stayed the same:**
- ✅ All route paths, request/response shapes, HTTP status codes
- ✅ Metrics output and gauge updates
- ✅ S3 health checks, DHT announcements, pin tracking
- ✅ `src/ipfs-node.ts`, `src/metrics.ts`, `src/reprovide.ts` (untouched)

**Breaking changes:** None (pure structural refactor).

## Verification

Run the test suite to verify no regressions:

```bash
npm test
```

Expected: ≥34 tests passing, 9 skipped (baseline before refactor).

All route endpoints function identically; only the internal code organisation changed.
