# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Communication Rules

**CRITICAL: NEVER use celebratory or decorative emojis (such as party poppers, stars, sparkles, etc.) in responses.** These are explicitly forbidden and make the user angry.

Acceptable emojis:
- Checkboxes: ✅ ❌ ✓ ✗
- Status indicators ONLY when truly necessary

All other emojis are BANNED. Use clear, professional text instead.

## Project Overview

This is a production-ready **custom-built IPFS node** that provides an HTTP API for distributed file storage. It combines libp2p (P2P networking) with S3/MinIO backend for persistent blockstore and datastore storage. The server exposes REST endpoints for file operations and includes built-in Prometheus metrics monitoring.

**Note: This project replaces Helia with a custom TypeScript IPFSNode class** (v0.7+). The custom implementation removes the Helia abstraction layer while maintaining full feature parity.

**CRITICAL: This project uses Node.js v24.** libp2p v3+ requires Node.js v24+ features.

**CRITICAL: This project uses S3/MinIO** for persistent IPFS blockstore and datastore. Configuration is handled via environment variables (see [S3-STORAGE.md](docs/S3-STORAGE.md)).

## Documentation

Comprehensive documentation is available in the `docs/` directory:

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Helia + Kubo delegated routing pattern, system design
- **[PEER_DISCOVERY.md](docs/PEER_DISCOVERY.md)** — libp2p peer discovery architecture (bootstrap, DHT, delegated routing) - **READ THIS BEFORE MODIFYING NETWORKING**
- **[GATEWAY_INTEGRATION.md](docs/GATEWAY_INTEGRATION.md)** — How to use the IPFS gateway (port 4040) to display file previews in your app
- **[TESTING.md](docs/TESTING.md)** — Complete testing guide (45 automated tests, 9 skipped)
- **[BEST-PRACTISES.md](docs/BEST-PRACTISES.md)** — Essential patterns for network operations, testing, API design, and common mistakes to avoid

## Development Guidelines

**READ FIRST:**
- [TESTING.md](docs/TESTING.md) — Complete testing guide (45 automated tests, 9 skipped)
- [BEST-PRACTISES.md](docs/BEST-PRACTISES.md) — Essential patterns for network operations, testing, API design, and common mistakes to avoid


## Commands

### Commands to NEVER Use Unless Explicitly Requested
- `npm start` or `npm run start` - **NEVER use unless explicitly prompted by the user**
- `npm run build` - **NEVER use unless explicitly prompted by the user**
- `npx tsc --noEmit` - **NEVER use unless explicitly prompted by the user**
  - **CRITICAL:** These commands are forbidden during development

### Testing

Tests use Node.js v24 built-in test runner (`node:test`). Automatic server lifecycle management with intelligent reference counting.

**Quick start:**
```bash
npm test              # 45 tests total (34 pass, 9 skip), ~10 seconds
npm run test:watch   # Watch mode for development
```

See [docs/TESTING.md](docs/TESTING.md) for comprehensive guide, architecture, troubleshooting, and how to run manual tests.

## Architecture

### ESM Configuration Requirements

This project requires specific configuration to work correctly with ESM and TypeScript:

1. **package.json** must have `"type": "module"` - this makes `.js` extensions interpreted as ESM by default
2. **tsconfig.json** requires:
   - `"module": "ES2022"` - supports modern features like private class fields
   - `"target": "ES2021"` - ensures ESM output instead of CommonJS
   - `"moduleResolution": "node"` - enables both `import` and `require`

3. **TypeScript execution**: The project uses `tsx` for running TypeScript files:
   - `tsx` has native support for path aliases and ESM
   - Development: `npm run dev` (uses nodemon + tsx)
   - Direct execution: `npm start` (uses tsx directly)

### Path Aliases

The project uses TypeScript path aliases for cleaner imports:

- `@/*` → `src/*` - General src imports
- `@api/*` → `src/api/*` - API-related modules
- `@storage/*` → `src/storage/*` - Helia/IPFS storage modules
- `@utils/*` → `src/utils/*` - Utility functions
- `@websocket/*` → `src/websocket/*` - WebSocket server modules
- `@upload/*` → `src/upload/*` - Upload handling modules

**Example:**
```typescript
// Instead of: import { logger } from '../utils/logger.js'
import { logger } from '@utils/logger.js'

// Instead of: import { initialiseHelia } from './storage/helia-client.js'
import { initialiseHelia } from '@storage/helia-client.js'
```

**Note:** You still need to include the `.js` extension (required for ESM compatibility).

### Project Structure

**Main application:**
- `src/index.ts` - Express server entry point; initialises IPFSNode, S3 backend, and HTTP servers
- `src/ipfs-node.ts` - **Custom IPFSNode class** combining libp2p, blockstore, datastore, and pinning; includes critical S3 error wrapper
- `src/internal-api.ts` - REST API endpoints for /health, /peers, /connections, /announce, /providers, /ping, /blocks, /metrics
- `src/libp2p-config.ts` - libp2p node factory with DHT server mode, TCP/WebSocket transports, bootstrap configuration
- `src/metrics.ts` - Prometheus metrics setup and collectors
- `src/logger.ts` - Structured logging with pino
- `src/backup-bootstrap/` - Backup peer persistence logic for network resilience

**Tests:**
- `test/*.spec.js` - Comprehensive test suite covering health, peer connectivity, file operations, metrics
- `test/helpers/server.js` - Test server startup with improved error diagnostics

**Configuration:**
- `tsconfig.json` - TypeScript compiler configuration with ES2022 module output
- `.env` - Environment variables for S3, routing, logging
- `openapi.yaml` - API specification for REST endpoints

### Key Dependencies

**Core (libp2p-based):**
- **libp2p** (v1.9+) - P2P networking framework (replaces Helia)
- **@libp2p/tcp** - TCP transport for libp2p
- **@libp2p/websockets** - WebSocket transport for browser compatibility
- **@libp2p/kad-dht** - Kademlia Distributed Hash Table for peer discovery
- **@libp2p/bootstrap** - Bootstrap peer discovery
- **blockstore-s3** (v3) - S3-backed block storage
- **datastore-s3** (v13) - S3-backed datastore for metadata and pins

**HTTP & API:**
- **express** (v5) - HTTP server framework
- **cors** - Cross-Origin Resource Sharing middleware

**Monitoring:**
- **prom-client** (v15) - Prometheus metrics collection and exposition
- **pino** & **pino-pretty** - Structured JSON logging with pretty output

**Development & Build:**
- **tsx** (v4) - Fast TypeScript execution engine with native ESM and path alias support
- **nodemon** (v3) - File watcher for auto-reload during development
- **typescript** (v5) - TypeScript compiler

**Note:** Helia (v6) has been removed (v0.7+). The custom IPFSNode class provides equivalent functionality without the abstraction layer.

All dependency versions are pinned in `package.json` to ensure consistency. Do NOT update major versions without testing against Node.js v24 features.

## Critical Rules

### CRITICAL: S3Datastore Error Wrapper (The ONLY Way It Works)

**S3Datastore REQUIRES a `.get()` error wrapper in `src/ipfs-node.ts`** (lines 14-61). This is non-negotiable and the ONLY way libp2p initialises successfully.

**The Problem:**
- libp2p's peer-store expects `NotFoundError` when keys don't exist
- S3Datastore throws `GetFailedError: NoSuchKey` instead
- Without the wrapper, startup fails with: "Failed to create libp2p node: NoSuchKey: The specified key does not exist."

**The Solution:**
The `wrapDatastoreWithErrorHandler()` function in `src/ipfs-node.ts` wraps the datastore's `.get()` and `.has()` methods to convert S3 errors to the format libp2p expects. **NEVER remove this wrapper.**

### NEVER Use `npm run dev`, `npm start`, `npm run build`, or `npx tsc` Unless Explicitly Prompted

These are the most important rules for this project:
- **NEVER use `npm start` or `npm run start`** unless explicitly requested by the user
- **NEVER use `npm run build`** unless explicitly requested by the user
- **NEVER use `npx tsc --noEmit`** or any `tsc` commands unless explicitly requested by the user
- Building, type checking, and starting are only for production or when specifically requested

**MinIO Setup:**
S3 buckets must exist in MinIO before startup:
```bash
# Via MinIO console (http://localhost:9001):
# 1. Login with minioadmin:minioadmin
# 2. Create buckets: glashaus-blocks, glashaus-data

# Or via MC CLI:
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/glashaus-blocks --ignore-existing
```

### AVOID Plan Mode Unless Explicitly Requested

- **AVOID plan mode** - Only use when explicitly requested by the user
- **Keep planning direct and minimal** - Focus on specific changes needed, not elaborate multi-phase workflows

## Important Notes

**ESM & Imports:**
- Import paths need file extensions (e.g., `import foo from '@utils/bar.js'` not `@utils/bar`)
- TypeScript will not add these extensions automatically
- Use path aliases (e.g., `@utils/`, `@storage/`) instead of relative paths for cleaner imports

**Development & Build:**
- This project uses JIT (Just-In-Time) compilation via tsx for development convenience
- The compiled output from `npm run build` follows tsconfig.json settings (ES2022/ES2021)

**S3 Storage Requirements:**
- **NEVER use MemoryBlockstore or MemoryDatastore** - They will cause data loss. Always use S3 blockstore/datastore (see [S3-STORAGE.md](docs/S3-STORAGE.md))
- S3 bucket creation: Buckets must exist before startup (auto-created when S3_BLOCKSTORE_BUCKET and S3_DATASTORE_BUCKET are set)
- The S3Datastore `.get()` error wrapper is critical (lines ~120-135 in `src/storage/helia.ts`) - do not remove or modify it

## Working with ipfs-shard

### Learning Resources

**Common questions?** Start with [GUIDELINE.md](docs/GUIDELINE.md) for theoretical questions and guidelines


## API Endpoints

All endpoints are on the internal API server (port 4000 by default, configurable via `NODE_INTERNAL_PORT`).

### Health & Status
- `GET /health` - Health check; returns peer ID, connection count, DHT mode, uptime, multiaddrs

### Network Queries
- `GET /peers` - List all known peer IDs connected to this node
- `GET /connections` - List active libp2p connections with metadata (direction, addresses, encryption, muxer)
- `POST /ping` - Ping a peer; request body: `{ "peer": "<multiaddr>" }` (e.g., `/ip4/1.2.3.4/tcp/4001/p2p/12D3Koo...`); returns latency in milliseconds

### DHT & Content
- `GET /providers/:cid` - Find DHT providers for a CID; returns providers list with peer IDs and addresses; respects timeout
- `GET /blocks/:cid` - Check if a block exists in the S3 blockstore; returns `{ "cid": "...", "exists": true/false }`

### Content Announcement (Next.js → helia-shard)
- `POST /announce` — Announce content to DHT; request body: `{ "cid": "..." }` (called by Next.js after upload)

## Architecture Patterns

This project can be extended with a hybrid WebSocket upload pattern:
- Next.js handles authentication and orchestration
- Browser uploads directly to Helia server via WebSocket
- See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for complete architectural details

## Critical Reminders

- to memorize **CRITICAL: S3Datastore error wrapper is non-negotiable** - Located in `src/ipfs-node.ts` (lines 14-61)
- to memorize **CRITICAL: IPFSNode is the IPFS runtime** - Custom class combining libp2p + blockstore + datastore. File: `src/ipfs-node.ts`
- to memorize **CRITICAL: libp2p configuration is production-critical** - See [PEER_DISCOVERY.md](docs/PEER_DISCOVERY.md). Must preserve: bootstrap peers, Kademlia DHT (server mode), persistent reconnect. File: `src/libp2p-config.ts`
- to memorize **Helia has been removed (v0.7+)** - Replaced with custom IPFSNode class for direct libp2p + S3 integration
- to memorize **ALWAYS** Close the dev server after you opened it for testing
- to memorize **ALWAYS** create .md files only in the ./docs folder
- to memorize **NEVER** use MemoryDatastore or MemoryBlockstore - They cause data loss, always use S3