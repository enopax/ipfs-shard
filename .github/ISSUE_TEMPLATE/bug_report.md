---
name: Bug Report
about: Report a bug or issue with ipfs-shard
title: "[BUG] "
labels: bug
assignees: ''
---

## Description

A clear and concise description of what the bug is.

## Steps to Reproduce

1. Step 1
2. Step 2
3. ...

## Expected Behaviour

What you expected to happen.

## Actual Behaviour

What actually happened.

## Environment

- **Node.js version:** (output of `node --version`)
- **npm version:** (output of `npm --version`)
- **OS:** (e.g., macOS, Linux, Windows)
- **S3 Backend:** (MinIO, AWS S3, etc.)

## Configuration

Share relevant `.env` variables (without credentials):

```bash
NODE_INTERNAL_PORT=4000
LOG_LEVEL=info
# ... other non-sensitive variables
```

## Logs

Share error logs or relevant output (set `LOG_LEVEL=debug` for more details):

```
[paste logs here]
```

## Additional Context

Any additional context that might help identify the issue (screenshots, related issues, etc.).

## Checklist

- [ ] I've checked existing issues and discussions
- [ ] I can reproduce the issue consistently
- [ ] I've provided relevant logs with `LOG_LEVEL=debug`
- [ ] I haven't shared any credentials or sensitive data
