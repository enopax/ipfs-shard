# Security Policy

## Reporting Security Vulnerabilities

ipfs-shard takes security seriously. If you discover a security vulnerability, please report it responsibly rather than opening a public GitHub issue.

### How to Report

Please email security reports to: **[security contact email]**

Include:
- Description of the vulnerability
- Steps to reproduce (if applicable)
- Potential impact
- Your suggested fix (if you have one)

We will acknowledge your report within 48 hours and provide an update on the status within 7 days.

## Security Considerations for Operators

### 1. S3 Storage Security

**Protect your S3 credentials:**
- Never commit `.env` files with credentials to version control
- Use AWS IAM roles in production (avoid long-lived access keys)
- Restrict S3 bucket policies to minimal necessary permissions
- Enable S3 versioning and lifecycle policies
- Consider S3 encryption (SSE-S3 or SSE-KMS)

**Bucket policy example (AWS S3):**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::ACCOUNT_ID:role/ipfs-shard-role"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::glashaus-blocks/*",
        "arn:aws:s3:::glashaus-data/*"
      ]
    }
  ]
}
```

### 2. Network Security

**Public Deployments:**
- Run behind a reverse proxy (Nginx, HAProxy)
- Enable TLS/HTTPS for all external connections
- Use a firewall to restrict access to internal API port (4000)
- Disable or restrict `/announce` endpoint if not needed
- Rate limit API endpoints to prevent abuse

**Reverse Proxy Example (Nginx):**

```nginx
upstream ipfs_shard {
    server localhost:4000;
}

server {
    listen 443 ssl http2;
    server_name ipfs-shard.example.com;

    # TLS certificates
    ssl_certificate /etc/letsencrypt/live/ipfs-shard.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/ipfs-shard.example.com/privkey.pem;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;
    limit_req zone=api_limit burst=20 nodelay;

    location / {
        proxy_pass http://ipfs_shard;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 3. Peer Discovery Security

**Bootstrap Peers:**
- Default peers are from Kubo project (generally trusted)
- Review `BOOTSTRAP_PEERS` configuration before deployment
- Verify peer IDs match known Kubo infrastructure

**DHT Server Mode:**
- ipfs-shard runs as a DHT server (answers queries from other peers)
- This is normal and expected behaviour
- Monitor peer connections: `curl http://localhost:4000/peers`

### 4. Access Control

**Internal API (port 4000):**
- Not intended for public internet exposure
- Only allow internal network access
- Use firewall rules or network policies
- Consider authentication layer if exposed

**Sensitive Endpoints:**
- `/announce` — Only call from trusted applications
- `/providers/:cid` — Public lookup, safe to expose
- `/health` — Safe to expose for monitoring

### 5. Dependency Management

**Keep dependencies updated:**

```bash
npm audit          # Check for known vulnerabilities
npm update         # Update to latest compatible versions
npm outdated       # See what's outdated
```

**Pin versions in production:**
- Use `npm ci` (not `npm install`) in CI/CD
- Lock package versions in production
- Review dependency security advisories regularly

## Known Limitations

### 1. Peer Identity Persistence
- Peer ID is stored in S3 datastore
- Changing S3 bucket or region will generate a new peer ID
- Existing peer records in DHT won't transfer (lost history)

### 2. Content Authenticity
- ipfs-shard stores content blocks, not content validity
- No built-in signature verification
- Implement application-level content validation if needed

### 3. Network Privacy
- P2P connections use Noise encryption (libp2p standard)
- DHT announcements are queryable by anyone
- Content hashes are public (IPFS design)
- Don't announce sensitive content to DHT

## Security Best Practices

### Development
- Use `LOG_LEVEL=info` or higher in production (not `debug`)
- Disable verbose logging in high-traffic scenarios
- Regularly rotate S3 access keys
- Use separate S3 buckets per environment (dev, staging, prod)

### Monitoring
- Enable Prometheus metrics: `curl http://localhost:4000/metrics`
- Set up alerts for unusual peer activity
- Monitor S3 access logs and API calls
- Track API error rates and latencies

### Updates
- Subscribe to security advisories
- Test updates in staging environment first
- Keep Node.js v24 updated (`npm` included)
- Review dependency changes before upgrading

## Deployment Checklist

- [ ] S3 credentials stored securely (not in code)
- [ ] AWS IAM roles configured with minimal permissions
- [ ] Reverse proxy configured with TLS
- [ ] Rate limiting enabled
- [ ] Firewall restricts internal API (port 4000) access
- [ ] Monitoring and alerting configured
- [ ] S3 buckets encrypted and versioned
- [ ] Backup strategy in place
- [ ] Recovery plan documented
- [ ] Dependencies updated and audited

## Security Disclosure

We follow responsible disclosure practices:

1. **Report privately** — Email to security contact
2. **Acknowledgment** — We'll acknowledge within 48 hours
3. **Investigation** — We'll work to understand and fix the issue
4. **Fix & Release** — We'll patch and release a security update
5. **Credit** — You'll be credited in security advisory (optional)

Thank you for helping keep ipfs-shard secure! 🔐

---

For more information on IPFS security, see [IPFS Security Docs](https://docs.ipfs.tech/how-to/security/).
