# GitHub Release Checklist & Guide

This document guides you through publishing ipfs-shard as a public GitHub repository.

## Pre-Release Checklist

### Repository Setup
- [ ] Create new GitHub repository at https://github.com/yourusername/ipfs-shard
- [ ] Initialize with MIT LICENSE (ipfs-shard has LICENSE file)
- [ ] Add description: "Production-ready, server-native IPFS node with S3 storage and strong peer connectivity"
- [ ] Add topics: `ipfs`, `p2p`, `distributed-storage`, `dht`, `libp2p`
- [ ] Set repository visibility to **Public**

### Documentation
- [ ] ✅ README.md — Comprehensive with quick start and features
- [ ] ✅ LICENSE — MIT license included
- [ ] ✅ CONTRIBUTING.md — Contribution guidelines
- [ ] ✅ CODE_OF_CONDUCT.md — Community standards
- [ ] ✅ SECURITY.md — Security reporting and best practices
- [ ] ✅ CHANGELOG.md — Version history
- [ ] ✅ .env.example — Configuration reference
- [ ] ✅ .github/ — Issue templates, PR template, workflows
- [ ] ✅ docs/ — Comprehensive technical documentation

### Code Quality
- [ ] ✅ npm test passes (45 tests)
- [ ] ✅ npx tsc --noEmit passes (no TypeScript errors)
- [ ] ✅ npm audit passes (no critical vulnerabilities)
- [ ] ✅ .gitignore properly configured
- [ ] ✅ No secrets or credentials in code
- [ ] ✅ No personal/sensitive data in documentation
- [ ] ✅ No hardcoded endpoints or API keys

### Package Configuration
- [ ] ✅ package.json removed "private": true
- [ ] ✅ package.json has proper license field
- [ ] ✅ package.json has repository URL
- [ ] ✅ package.json has keywords
- [ ] ✅ package.json has author/maintainer info
- [ ] ✅ package.json has homepage
- [ ] ✅ package.json has bugs URL

### GitHub Configuration
- [ ] Go to repository Settings
- [ ] **General Tab:**
  - [ ] Repository template: unchecked
  - [ ] Default branch: `main`
  - [ ] Require pull request reviews: enabled (recommended)
  - [ ] Dismiss stale pull request approvals: enabled
  - [ ] Require status checks to pass: enabled
  - [ ] Require branches to be up to date: enabled
  - [ ] Delete head branches: enabled

- [ ] **Branches Tab:**
  - [ ] Add branch protection rule for `main`
  - [ ] Require pull request reviews (at least 1)
  - [ ] Require status checks (test workflow)
  - [ ] Require branches to be up-to-date

- [ ] **Code Security & Analysis:**
  - [ ] Enable Dependabot alerts
  - [ ] Enable Dependabot security updates
  - [ ] Enable Secret scanning (if available)

- [ ] **Pages (optional):**
  - [ ] Enable GitHub Pages from `docs/` (for documentation site)
  - [ ] Use GitHub-flavored Markdown theme

## First Release Steps

### 1. Create Initial Release

```bash
# Make sure you're on main branch
git checkout main
git pull origin main

# Create a git tag
git tag -a v0.7.3 -m "Initial public release

- Production-ready IPFS node with S3 storage
- libp2p v3 integration
- Multi-protocol bitswap support
- IPNI provider lookup
- Comprehensive documentation and tests"

# Push tag to GitHub
git push origin v0.7.3
```

### 2. Create GitHub Release

1. Go to https://github.com/yourusername/ipfs-shard/releases/new
2. Select tag: `v0.7.3`
3. Release title: `v0.7.3 — Initial Public Release`
4. Release description:

```markdown
# ipfs-shard v0.7.3

Initial public release of ipfs-shard—a production-ready, server-native IPFS node.

## Key Features

✓ Custom IPFSNode class (libp2p-based, no Helia dependency)
✓ S3/MinIO persistent storage
✓ Full DHT server node with bootstrap peers
✓ Multi-protocol bitswap (1.0.0, 1.1.0, 1.2.0)
✓ IPNI provider lookup for content discovery
✓ REST API for peer queries and content routing
✓ Prometheus metrics and health monitoring
✓ 45 automated tests covering all endpoints
✓ Comprehensive documentation and deployment guides

## What's Included

- Source code with full TypeScript types
- Automated test suite (45 tests)
- Docker Compose setup for local development
- Complete API documentation
- Peer discovery and DHT guides
- Security best practices
- Contribution guidelines

## Get Started

```bash
npm install
docker run -d -p 9000:9000 -p 9001:9001 minio/minio:latest
npm run dev
```

See [README.md](README.md) for complete quick start.

## Documentation

- [README.md](README.md) — Overview and quick start
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System design
- [docs/DEVELOPERS.md](docs/DEVELOPERS.md) — Developer guide
- [CONTRIBUTING.md](CONTRIBUTING.md) — How to contribute
- [SECURITY.md](SECURITY.md) — Security policy

## What's New Since v0.7.2

- Multi-protocol bitswap negotiation (fixes compatibility)
- IPNI provider lookup tier (better content discovery)
- GitHub documentation and templates
- Contribution guidelines and code of conduct
- Security policy and best practices guide
- Enhanced README with architecture diagrams

## Known Limitations

- Bootstrap peers are manually configured
- Peer identity stored in S3 (changes with bucket)
- No built-in rate limiting (use reverse proxy)
- Content authenticity not verified (application-level)

## License

MIT — See [LICENSE](LICENSE)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

Thank you for trying ipfs-shard! 🚀
```

5. Click **Publish release**

### 3. Announce the Release

Create a release announcement issue:

```markdown
# 🎉 ipfs-shard is now public!

We're excited to announce the public release of **ipfs-shard** v0.7.3!

ipfs-shard is a production-ready, server-native IPFS node with:
- Direct libp2p v3 integration
- S3/MinIO persistent storage
- Strong peer connectivity via DHT
- REST API for content routing
- 45 automated tests
- Comprehensive documentation

**Get started:** https://github.com/yourusername/ipfs-shard#quick-start

**Documentation:** https://github.com/yourusername/ipfs-shard/tree/main/docs

**Contribute:** We welcome PRs and issues!

Join us in building decentralised infrastructure! 🌍
```

## Ongoing Maintenance

### After Each Release

1. **Update CHANGELOG.md** with new version
2. **Create GitHub Release** with details
3. **Announce** in relevant communities
4. **Update version** in package.json
5. **Tag in git** and push

### Regular Tasks

**Weekly:**
- Review open issues
- Check Dependabot alerts
- Monitor test failures

**Monthly:**
- Update dependencies
- Review security advisories
- Check npm audit

**Quarterly:**
- Review roadmap
- Plan next features
- Write blog post (if applicable)

## Marketing & Community

### Where to Announce
- **GitHub Discussions** — ipfs-shard repo
- **IPFS Discord** — #announcements channel
- **Twitter/X** — @yourusername
- **DEV Community** — IPFS tag
- **Reddit** — r/ipfs
- **Hacker News** — (if significant features)
- **Product Hunt** — (if major release)

### Sample Announcement

```
🌍 Announcing ipfs-shard — a production-ready IPFS node

ipfs-shard is a lightweight, server-native IPFS peer that combines:
✓ libp2p v3 for strong P2P connectivity
✓ S3/MinIO for scalable, persistent storage
✓ DHT server mode for full network participation
✓ REST API for easy integration
✓ 45 automated tests + comprehensive docs

Perfect for building decentralised file storage systems!

GitHub: https://github.com/yourusername/ipfs-shard
Docs: https://github.com/yourusername/ipfs-shard/tree/main/docs

#IPFS #Web3 #P2P
```

## Responding to Issues & PRs

### Issue Response Template

```markdown
Thanks for reporting this! I'll investigate and get back to you soon.

In the meantime, you can help by:
- Confirming steps to reproduce
- Sharing logs with LOG_LEVEL=debug
- Checking if [related issue] has similar symptoms

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.
```

### PR Review Checklist

- [ ] Tests pass (`npm test`)
- [ ] TypeScript compiles (`npx tsc --noEmit`)
- [ ] Code follows project style
- [ ] Commit messages are clear
- [ ] Documentation updated
- [ ] No credentials/secrets
- [ ] Changes are focused

## Resources for Maintainers

- [GitHub Docs: Managing a Repository](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features)
- [GitHub Docs: Collaborating with PRs](https://docs.github.com/en/pull-requests)
- [Keep a Changelog](https://keepachangelog.com/)
- [Semantic Versioning](https://semver.org/)

## Versioning Strategy

ipfs-shard uses Semantic Versioning:

- **MAJOR** (0 → 1) — Breaking changes, major features
- **MINOR** (0.7 → 0.8) — New features, backward compatible
- **PATCH** (0.7.3 → 0.7.4) — Bug fixes, security patches

Examples:
- v0.7.3 → v0.8.0 — New API endpoints, new features
- v0.8.0 → v1.0.0 — Production stable, major refactor
- v0.7.3 → v0.7.4 — Security fix, bug fix

## Going Forward

### Feature Ideas for Future Releases
- [ ] Replication API for block redundancy
- [ ] Delegated routing HTTP endpoint
- [ ] WebSocket API for real-time block retrieval
- [ ] Automatic backup/recovery mechanisms
- [ ] Advanced peer selection strategies
- [ ] Content verification and signing
- [ ] Multi-node clustering
- [ ] GraphQL API layer

### Community Opportunities
- [ ] Workshops & tutorials
- [ ] Case studies & blog posts
- [ ] Integration guides (Next.js, etc.)
- [ ] Client libraries for other languages
- [ ] Network visualization tool

---

Welcome to the ipfs-shard community! 🚀
