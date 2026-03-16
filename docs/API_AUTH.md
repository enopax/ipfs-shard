# API Authentication

This document explains how API authentication works in ipfs-shard and how to implement it in Next.js clients.

## Overview

The API supports two authentication modes depending on the environment:

- **Development (`NODE_ENV=development`)**: No authentication required, all origins allowed
- **Production**: CORS origin validation + API key authentication (required)

### Security Status

✅ **The HTTP API is now secured with API key authentication.** You no longer need to restrict the API to `localhost` — the API can be bound to `0.0.0.0` and safely exposed to the network. Authentication via the `X-Api-Key` header protects all administrative operations (pins, announcements, etc.).

## Environment Variables

```env
# API Configuration
NODE_ENV=development           # Set to 'production' to enable authentication
API_KEY=your-secret-key       # Required in production; leave empty to disable
ALLOWED_ORIGINS=https://glashaus.xyz  # Comma-separated list of allowed origins
```

## Dev vs Production Behaviour

### Development Mode

When `NODE_ENV=development`:
- CORS allows all origins (`*`)
- API key validation is skipped
- Perfect for local testing and development

```bash
# Set in .env for development
NODE_ENV=development
API_KEY=
ALLOWED_ORIGINS=
```

### Production Mode

When `NODE_ENV` is not set to `development`:
- CORS restricts requests to `ALLOWED_ORIGINS`
- API key is enforced if `API_KEY` is set in `.env`
- Recommended for deployed instances

```bash
# Set in .env for production
NODE_ENV=production
API_KEY=your-secret-key-here
ALLOWED_ORIGINS=https://glashaus.xyz
```

## API Key Authentication

When `API_KEY` is configured in production, all API requests must include the `X-Api-Key` header:

```http
GET /health HTTP/1.1
Host: api.example.com
X-Api-Key: your-secret-key
```

### CORS Headers

The API automatically includes these CORS headers:
- `Access-Control-Allow-Origin`: Based on `ALLOWED_ORIGINS` (dev: `*`)
- `Access-Control-Allow-Methods`: `GET, POST, DELETE, OPTIONS`
- `Access-Control-Allow-Headers`: `Content-Type, X-Api-Key`
- `Access-Control-Max-Age`: `86400` (24 hours)

## Next.js Implementation

### 1. Store API Key in Environment Variables

Create `.env.local` (not committed to git):

```env
NEXT_PUBLIC_IPFS_SHARD_API_URL=http://localhost:4000
IPFS_SHARD_API_KEY=your-secret-key-here
```

**Note:** Use `IPFS_SHARD_API_KEY` (not `NEXT_PUBLIC_*`) to keep it private. Only `NEXT_PUBLIC_*` variables are exposed to the browser.

### 2. Create a Fetch Wrapper

Create `lib/ipfs-shard-client.ts`:

```typescript
interface FetchOptions {
  method?: 'GET' | 'POST' | 'DELETE'
  body?: Record<string, any>
  signal?: AbortSignal
}

async function fetchIPFSShard(
  endpoint: string,
  options: FetchOptions = {}
): Promise<any> {
  const apiUrl = process.env.NEXT_PUBLIC_IPFS_SHARD_API_URL
  if (!apiUrl) {
    throw new Error('NEXT_PUBLIC_IPFS_SHARD_API_URL not configured')
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  // Add API key if configured
  const apiKey = process.env.IPFS_SHARD_API_KEY
  if (apiKey) {
    headers['X-Api-Key'] = apiKey
  }

  const response = await fetch(`${apiUrl}${endpoint}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(
      `IPFS Shard API error: ${response.status} ${error.error || response.statusText}`
    )
  }

  return response.json()
}

export default fetchIPFSShard
```

### 3. Use in API Routes (Server-Side)

**`pages/api/upload.ts`:**

```typescript
import type { NextApiRequest, NextApiResponse } from 'next'
import fetchIPFSShard from '@/lib/ipfs-shard-client'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { cid } = req.body

    // Call ipfs-shard to announce content
    await fetchIPFSShard('/announce', {
      method: 'POST',
      body: { cid },
    })

    return res.status(200).json({ success: true, cid })
  } catch (error) {
    console.error('Upload failed:', error)
    return res.status(500).json({ error: String(error) })
  }
}
```

### 4. Use in React Components (Client-Side)

**Note:** API key is only available on the server. Client-side requests must go through your Next.js API routes.

**`app/components/FileUpload.tsx`:**

```typescript
'use client'

import { useState } from 'react'

export default function FileUpload() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsLoading(true)
    setError(null)

    try {
      // 1. Upload file and get CID (your existing logic)
      const formData = new FormData()
      formData.append('file', file)
      const uploadResponse = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      if (!uploadResponse.ok) {
        throw new Error('Upload failed')
      }

      const { cid } = await uploadResponse.json()

      // 2. Announce to IPFS via API route (which adds API key)
      const announceResponse = await fetch('/api/announce', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cid }),
      })

      if (!announceResponse.ok) {
        throw new Error('Announcement failed')
      }

      alert(`File uploaded! CID: ${cid}`)
    } catch (err) {
      setError(String(err))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div>
      <input
        type="file"
        onChange={handleUpload}
        disabled={isLoading}
      />
      {error && <p style={{ color: 'red' }}>{error}</p>}
    </div>
  )
}
```

**`pages/api/announce.ts`:**

```typescript
import type { NextApiRequest, NextApiResponse } from 'next'
import fetchIPFSShard from '@/lib/ipfs-shard-client'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const { cid } = req.body

    if (!cid) {
      return res.status(400).json({ error: 'CID required' })
    }

    // API key is automatically added by fetchIPFSShard
    await fetchIPFSShard('/announce', {
      method: 'POST',
      body: { cid },
    })

    return res.status(200).json({ success: true })
  } catch (error) {
    console.error('Announcement failed:', error)
    return res.status(500).json({ error: String(error) })
  }
}
```

## Testing

### Test without API Key (Development)

```bash
# Terminal 1: Start ipfs-shard with NODE_ENV=development
NODE_ENV=development npm run dev

# Terminal 2: Test API (no header needed)
curl http://localhost:4000/health
```

### Test with API Key (Production)

```bash
# Terminal 1: Start ipfs-shard with API_KEY set
API_KEY=secret123 npm run dev

# Terminal 2: Request without API key (should fail)
curl http://localhost:4000/health
# Returns: 401 Unauthorized - "Authentication required"

# Terminal 3: Request with API key (should work)
curl -H "X-Api-Key: secret123" http://localhost:4000/health
# Returns: 200 OK with health data
```

## Security Considerations

1. **Never commit API keys** - Use `.env.local` and `.env*.local` patterns
2. **Use HTTPS in production** - API keys must be transmitted over HTTPS
3. **Rotate keys regularly** - Change `API_KEY` periodically
4. **Keep server-side only** - Don't expose API keys in client-side code
5. **CORS validation** - Always set `ALLOWED_ORIGINS` to your exact domain in production

## Troubleshooting

### "Authentication required" Error
- Ensure `API_KEY` is set in `.env` on the ipfs-shard server
- Verify the Next.js client is using `IPFS_SHARD_API_KEY` from `.env.local`
- Check that `X-Api-Key` header is being sent in requests

### CORS Error in Browser
- Verify your domain is in `ALLOWED_ORIGINS` on the server
- Check that browser requests go through Next.js API routes (not directly to ipfs-shard)
- Ensure `Access-Control-Allow-Origin` header is present in response

### "Method not allowed" Error
- Verify the HTTP method (GET, POST, DELETE) matches the endpoint
- Check endpoint path for typos

## Environment Variables Reference

| Variable | Purpose | Dev Default | Prod Default |
|----------|---------|-------------|--------------|
| `NODE_ENV` | Environment mode | `development` | `production` |
| `API_KEY` | Secret authentication key (required in production) | (empty) | (must be set) |
| `ALLOWED_ORIGINS` | CORS whitelist | `*` | (must be set) |
| `NODE_INTERNAL_PORT` | API server port | `4000` | `4000` |
| `API_HOST` | Bind address | `0.0.0.0` | `0.0.0.0` (secured by API key) |
