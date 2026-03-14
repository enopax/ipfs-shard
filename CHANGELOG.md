# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.3] - 2026-03-11

### Added
- Multi-protocol bitswap support (1.0.0, 1.1.0, 1.2.0) for wider peer compatibility
- IPNI (InterPlanetary Network Indexer) provider lookup as additional retrieval tier
- Comprehensive GitHub documentation (CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md)
- GitHub issue and pull request templates
- `.env.example` file for configuration reference
- Enhanced README with architecture diagrams and quick start guide

### Fixed
- Bitswap protocol negotiation errors when peers don't support 1.2.0
- Block retrieval now falls through to IPNI before gateway fallback
- Improved error handling in network blockstore

### Changed
- Documentation restructured for public GitHub release
- package.json updated with proper metadata (license, repo, keywords)
- Improved logging consistency across modules

## [0.7.2] - 2026-03-10

### Added
- Custom SimpleBitswap implementation with bidirectional streams
- Timeout system for DHT and bitswap fallbacks (5s each)
- NetworkAwareBlockstore with multi-tier retrieval
- LRU block cache support via BLOCK_CACHE_MB env var
- Comprehensive test suite (45 tests covering all endpoints)

### Fixed
- 500 → 404 error handling for missing blocks in `/cat/:cid`
- Bitswap stream management and cleanup
- Peer connection lifecycle

### Changed
- Removed ipfs-bitswap dependency (custom SimpleBitswap for libp2p v3 compatibility)
- Improved block retrieval performance with local caching

## [0.7.1] - 2026-03-09

### Added
- DHT re-provide loop (reprovide.ts) — refreshes provider records every 22 hours
- GET /pins endpoint — lists all pinned CIDs
- S3 health check in /health response
- HTTP and block retrieval metrics (Prometheus)

### Fixed
- Pin counts not updating in metrics
- S3 connectivity not reported in health checks

### Changed
- Metrics instrumentation across HTTP, blocks, and pinning operations

## [0.7.0] - 2026-02-15

### Added
- Custom IPFSNode class (replacement for Helia)
- Direct libp2p v3 integration
- S3-backed blockstore and datastore
- Full DHT server mode
- SimpleBitswap protocol implementation
- REST API endpoints for peer discovery, content routing, metrics
- Prometheus metrics support
- Structured logging with pino

### Removed
- Helia dependency (replaced with custom IPFSNode)
- MemoryBlockstore and MemoryDatastore

### Changed
- Core architecture now libp2p-first
- Storage layer completely abstracted to S3
- API port and configuration (see migration guide)

## [0.6.x] - Previous Versions

See [Git History](https://github.com/yourusername/ipfs-shard/commits) for details on earlier versions using Helia.

---

## Unreleased

### Planned
- [ ] Replication API for block redundancy
- [ ] Delegated routing HTTP endpoint
- [ ] WebSocket API for real-time block retrieval
- [ ] Automatic backup and recovery mechanisms
- [ ] Advanced peer selection strategies
- [ ] Content verification and signing

---

For upgrading from previous versions, see [UPGRADING.md](docs/UPGRADING.md) (if available).

For detailed release notes, see [Releases](https://github.com/yourusername/ipfs-shard/releases).
