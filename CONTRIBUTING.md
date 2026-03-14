# Contributing to ipfs-shard

Thank you for your interest in contributing to ipfs-shard! This document provides guidelines and instructions for contributing.

## Code of Conduct

Please be respectful and constructive in all interactions with other contributors and maintainers. We are committed to providing a welcoming and inclusive environment for all.

## Getting Started

### Prerequisites
- Node.js v24
- Docker & Docker Compose (for local S3/MinIO testing)
- Git

### Development Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/ipfs-shard.git
cd ipfs-shard

# Install dependencies
npm install

# Start MinIO (S3 backend for testing)
docker run -d -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"

# Create S3 buckets
mc alias set local http://localhost:9000 minioadmin minioadmin
mc mb local/glashaus-blocks --ignore-existing
mc mb local/glashaus-data --ignore-existing

# Configure .env for development
cp .env.example .env  # (adjust as needed)

# Start development server
npm run dev

# In another terminal, run tests
npm test
```

## Making Changes

### 1. Create a Feature Branch

```bash
git checkout -b feature/my-awesome-feature
# or for bug fixes:
git checkout -b fix/bug-description
```

### 2. Make Your Changes

- Follow the existing code style (TypeScript, no semicolons, 2-space indentation)
- Keep commits atomic and meaningful
- Write clear commit messages

### 3. Test Your Changes

```bash
# Run all tests
npm test

# Run specific test suite
npm run test:health
npm run test:peers
npm run test:blocks

# Watch mode for development
npm run test:watch

# Check type safety
npx tsc --noEmit
```

### 4. Update Documentation

If your changes affect:
- **API endpoints** — Update [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and/or root README.md
- **Architecture** — Update [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- **Configuration** — Update this CONTRIBUTING.md and README.md environment variables section
- **Testing** — Update [docs/TESTING.md](docs/TESTING.md)
- **Peer discovery** — Update [docs/PEER_DISCOVERY.md](docs/PEER_DISCOVERY.md)

### 5. Push and Create a Pull Request

```bash
git push origin feature/my-awesome-feature
```

Open a Pull Request on GitHub with:
- Clear title describing the change
- Description of what changed and why
- Link to any related issues
- Confirmation that tests pass

## PR Review Checklist

Before submitting, ensure:

- ✅ Tests pass: `npm test`
- ✅ TypeScript compiles: `npx tsc --noEmit`
- ✅ Code follows existing style (no significant linting issues)
- ✅ Commit messages are clear and atomic
- ✅ Documentation is updated if needed
- ✅ No secrets or credentials in commits
- ✅ Changes are focused (avoid mixing unrelated changes)

## Project Structure

Key files for contributors:

```
src/
├── ipfs-node.ts              # Core IPFSNode class — main entry point for IPFS logic
├── libp2p-config.ts          # libp2p configuration — peer discovery, transports, DHT
├── bitswap.ts                # Bitswap protocol implementation — block exchange
├── blockstore-network.ts     # Network-aware blockstore — retrieval strategy (S3 + network + DHT + IPNI + gateway)
├── internal-api.ts           # HTTP API endpoints
├── logger.ts                 # Logging setup
└── index.ts                  # Server entry point

docs/
├── ARCHITECTURE.md           # System design and data flow
├── PEER_DISCOVERY.md         # Peer discovery and DHT configuration
├── BEST-PRACTISES.md         # Development patterns
└── TESTING.md                # Testing guide

test/
├── health.spec.js            # Health endpoint tests
├── peers.spec.js             # Peer connectivity tests
└── ...                        # Other endpoint tests
```

## Important Patterns

### Network Operations
See [docs/BEST-PRACTISES.md](docs/BEST-PRACTISES.md) for:
- How to handle DHT timeouts
- How to work with libp2p connections
- Common network error patterns

### Testing
- Always use the Node.js built-in test runner (`node:test`)
- Use async/await (no callbacks or promises unless necessary)
- Test fixtures should clean up after themselves
- See [docs/TESTING.md](docs/TESTING.md) for detailed guide

### Logging
- Use `logger.info()`, `logger.debug()`, `logger.warn()`, `logger.error()`
- Include context (CID, peer ID, etc.) in log objects
- Example: `logger.debug({ cid: cid.toString(), peer: peerId }, 'Block retrieved')`

## Common Contributions

### Adding a New API Endpoint

1. Add handler in `src/internal-api.ts`
2. Add tests in `test/` directory
3. Document in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
4. Update root README.md API section

### Improving Block Retrieval

The block retrieval chain is in `src/blockstore-network.ts`:

1. Local S3 blockstore
2. Bitswap broadcast to peers (5s timeout)
3. DHT provider lookup (5s timeout)
4. IPNI provider lookup (5s timeout)
5. Public gateway fallback

To modify, update the `get()` method and add appropriate tests.

### Fixing Network Issues

See [docs/PEER_DISCOVERY.md](docs/PEER_DISCOVERY.md) for:
- Bootstrap peer configuration
- DHT server mode setup
- Connection management

## Code Style Guidelines

### TypeScript
- Use explicit type annotations where helpful
- Avoid `any` unless absolutely necessary
- Use `const` by default, `let` when mutation is needed
- No `var`

### Naming
- camelCase for variables and functions
- PascalCase for classes and types
- UPPERCASE for constants

### Comments
- Only comment non-obvious logic
- Keep comments up-to-date with code changes
- Use JSDoc for public APIs

### File Organization
- Keep files focused and under 500 lines
- Related functions grouped logically
- Exports at the end of file

## Performance Considerations

- Avoid synchronous operations in hot paths
- Use async/await for all I/O
- Cache frequently accessed data (see `blockstore-cache.ts`)
- Monitor with Prometheus metrics (see `src/metrics.ts`)

## Reporting Issues

### Bug Reports

Please include:
- Node.js version
- Steps to reproduce
- Expected vs. actual behaviour
- Error logs (set `LOG_LEVEL=debug`)
- Environment details (S3 backend, network setup, etc.)

### Feature Requests

Please describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered
- Use cases and benefits

## Questions?

- Check [docs/](docs/) directory first
- Search existing [GitHub Issues](https://github.com/yourusername/ipfs-shard/issues)
- Open a [GitHub Discussion](https://github.com/yourusername/ipfs-shard/discussions)

## License

By contributing to ipfs-shard, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing to ipfs-shard! 🎉
