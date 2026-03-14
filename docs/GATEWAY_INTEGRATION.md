# Gateway Integration Guide

This guide explains how to properly integrate the IPFS gateway (port 4040) into your Next.js application to display file previews.

## Gateway Overview

The gateway exposes content via two URL formats:

```
http://localhost:4040/{CID}              # Direct format
http://localhost:4040/ipfs/{CID}         # Standard IPFS format
```

Both formats work identically. Use whichever fits your preference.

## Key Features

✅ **Automatic MIME Type Detection** — Files served with correct content-types (not downloads)
✅ **Magic Byte Detection** — Detects file types from content, works even without file extensions
✅ **Multipart Extraction** — Automatically extracts file content from HTTP multipart wrappers
✅ **Wrapped Content Handling** — Finds real content even when stored with headers/boundaries
✅ **Range Request Support** — Video scrubbing, partial downloads
✅ **Immutable Content Caching** — Content cached for 1 year (safe due to CID-based content addressing)

## Integration Pattern

### 1. Get the CID from Helia API

```typescript
// Upload file and get CID
const response = await fetch('http://localhost:4000/add', {
  method: 'POST',
  body: fileBuffer,
})

const { cid } = await response.json()
console.log(`File CID: ${cid}`)
```

### 2. Store CID in Your Database

```typescript
// Example: Save to database with file metadata
await db.files.create({
  cid,
  name: file.name,
  size: file.size,
  uploadedAt: new Date(),
  userId: currentUser.id
})
```

### 3. Display File Preview Using Gateway

#### Option A: Direct HTML Tags (Simplest)

```typescript
// For images
<img
  src={`http://localhost:4040/${cid}`}
  alt="Uploaded image"
/>

// For video
<video width="320" height="240" controls>
  <source src={`http://localhost:4040/${cid}`} type="video/mp4" />
  Your browser does not support the video tag.
</video>

// For audio
<audio controls>
  <source src={`http://localhost:4040/${cid}`} type="audio/mpeg" />
  Your browser does not support the audio tag.
</audio>

// For PDF (embed)
<embed
  src={`http://localhost:4040/${cid}`}
  type="application/pdf"
  width="100%"
  height="600px"
/>

// For downloading
<a
  href={`http://localhost:4040/${cid}`}
  download={filename}
>
  Download
</a>
```

#### Option B: Smart Preview Component (React/Next.js)

```typescript
import React from 'react'

interface FilePreviewProps {
  cid: string
  filename: string
  mimeType?: string // optional, will be auto-detected from magic bytes
}

export function FilePreview({ cid, filename, mimeType }: FilePreviewProps) {
  const gatewayUrl = `http://localhost:4040/${cid}`

  // Detect MIME type from filename extension if not provided
  const detectedMimeType = mimeType || getMimeTypeFromFilename(filename)

  // Images
  if (detectedMimeType?.startsWith('image/')) {
    return (
      <img
        src={gatewayUrl}
        alt={filename}
        style={{ maxWidth: '100%', maxHeight: '600px' }}
      />
    )
  }

  // Video
  if (detectedMimeType?.startsWith('video/')) {
    return (
      <video width="100%" height="auto" controls style={{ maxWidth: '100%' }}>
        <source src={gatewayUrl} type={detectedMimeType} />
        Your browser does not support the video tag.
      </video>
    )
  }

  // Audio
  if (detectedMimeType?.startsWith('audio/')) {
    return (
      <audio controls style={{ width: '100%' }}>
        <source src={gatewayUrl} type={detectedMimeType} />
        Your browser does not support the audio tag.
      </audio>
    )
  }

  // PDF
  if (detectedMimeType === 'application/pdf') {
    return (
      <embed
        src={gatewayUrl}
        type="application/pdf"
        width="100%"
        height="600px"
      />
    )
  }

  // Plain text, JSON, HTML, etc.
  if (detectedMimeType?.startsWith('text/') || detectedMimeType === 'application/json') {
    return (
      <iframe
        src={gatewayUrl}
        style={{
          width: '100%',
          height: '600px',
          border: '1px solid #ccc',
          borderRadius: '8px'
        }}
        title={filename}
      />
    )
  }

  // Unknown type - show download link
  return (
    <div style={{ padding: '20px', border: '1px dashed #ccc', borderRadius: '8px' }}>
      <p>File type not supported for preview</p>
      <a
        href={gatewayUrl}
        download={filename}
        style={{
          display: 'inline-block',
          padding: '8px 16px',
          backgroundColor: '#0070f3',
          color: 'white',
          borderRadius: '4px',
          textDecoration: 'none'
        }}
      >
        Download {filename}
      </a>
    </div>
  )
}

function getMimeTypeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    // Images
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    svg: 'image/svg+xml',
    webp: 'image/webp',
    // Video
    mp4: 'video/mp4',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    // Audio
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    // Documents
    pdf: 'application/pdf',
    txt: 'text/plain',
    html: 'text/html',
    json: 'application/json',
  }
  return mimeTypes[ext || ''] || 'application/octet-stream'
}
```

#### Option C: Proxy Through Your Backend (For Authentication)

If you need to add access control to the gateway:

```typescript
// pages/api/files/[cid].ts (Next.js API route)
import type { NextApiRequest, NextApiResponse } from 'next'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { cid } = req.query

  // Add authentication/authorization here
  // if (!isUserAuthorized(req, cid)) {
  //   return res.status(403).json({ error: 'Unauthorized' })
  // }

  // Proxy request to gateway
  const response = await fetch(`http://localhost:4040/${cid}`)

  // Forward headers
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  // Forward response status
  res.status(response.status)

  // Stream the response body
  const reader = response.body?.getReader()
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    } finally {
      reader.releaseLock()
    }
  }

  res.end()
}

// Then access via: /api/files/{cid}
// <img src={`/api/files/${cid}`} />
```

## URL Format Options

### Standard IPFS Paths
```
/ipfs/{CID}
/ipfs/{CID}/path/to/file.txt
```

### Direct CID Paths
```
/{CID}
/{CID}/path/to/file.txt
```

### Query Parameters (Future Enhancement)
```
/{CID}?download=true          # Force download
/{CID}?mime=image/jpeg        # Override MIME type
```

## Content-Type Handling

The gateway automatically detects content type from file magic bytes using a three-tier approach:

### Detection Strategy

1. **Extension-based** — If filename has extension, use standard MIME type mapping
2. **Magic Byte Detection** — Analyse file content to identify type:
   - Searches first 8KB for file signatures
   - Handles wrapped content (multipart form-data, etc.)
   - Detects: PNG, JPEG, GIF, WebP, BMP, TIFF, PDF, MP4, WebM, MP3, WAV, FLAC, SVG, ZIP, GZIP, TAR, HTML, JSON, XML, plain text

3. **Smart Fallback** — If detection fails, serves with `inline` disposition (browser decides what to do)

### Supported Formats

| File Type | Signature | Content-Type |
|-----------|-----------|--------------|
| PNG | `89 50 4E 47` | `image/png` |
| JPEG | `FF D8 FF` | `image/jpeg` |
| GIF | `47 49 46 38` | `image/gif` |
| WebP | `RIFF...WEBP` | `image/webp` |
| PDF | `25 50 44 46` | `application/pdf` |
| MP4 | `.......ftyp` | `video/mp4` |
| WebM | `1A 45 DF A3` | `video/webm` |
| MP3 | `FF FB/FA` | `audio/mpeg` |

### Multipart Extraction

When files are uploaded as **HTTP multipart form-data**, the gateway automatically:
- Detects multipart boundaries (`--...--`)
- Locates actual file content (after headers)
- Extracts and serves only the real file data
- Updates `Content-Length` to match extracted content

**This means images show in preview even without file extensions and even when wrapped in multipart!**

## CORS and Cross-Origin Access

The gateway is CORS-enabled. From any domain, you can:

```typescript
// From any domain/port
const image = new Image()
image.src = 'http://localhost:4040/bafykreih4wkrfiu...'
image.onload = () => console.log('Loaded!')
```

## Performance Tips

### 1. Use Content Delivery Network (CDN)

For production, put the gateway behind a CDN:

```typescript
// Use CDN URL instead
const cdnUrl = process.env.IPFS_GATEWAY_CDN || 'http://localhost:4040'
const imageUrl = `${cdnUrl}/${cid}`
```

### 2. Lazy Load Images

```typescript
<img
  src={`http://localhost:4040/${cid}`}
  alt="Lazy loaded"
  loading="lazy"
/>
```

### 3. Use srcset for Responsive Images

```typescript
<picture>
  <source
    srcSet={`http://localhost:4040/${cidSmall} 640w, http://localhost:4040/${cidLarge} 1280w`}
    media="(max-width: 640px)"
  />
  <img src={`http://localhost:4040/${cid}`} alt="Responsive" />
</picture>
```

### 4. Cache CIDs Client-Side

Since IPFS CIDs are immutable, cache indefinitely:

```typescript
const cacheControl = 'public, max-age=31536000, immutable' // 1 year
```

## Common Issues and Solutions

### Images Still Downloading or Not Displaying

**Problem:** Browser downloads images instead of showing them, or image is corrupted

**Solution:** Gateway uses intelligent magic byte detection and multipart extraction:
- [ ] Server has compiled latest code
- [ ] Accessing via `http://localhost:4040/{cid}` (works with both formats)
- [ ] Check Content-Type header is `image/*` (not `application/octet-stream`)

**Debug:**
```bash
# Check the Content-Type header
curl -I http://localhost:4040/bafykrei...
# Should show: Content-Type: image/jpeg (or image/png, etc.)
# NOT: Content-Type: application/octet-stream

# If multipart-wrapped file, gateway automatically extracts it
# No action needed - detection is automatic!

# Verify file isn't corrupted in IPFS
curl -s http://localhost:4040/bafykrei... | file -
# Should identify as image file (JPEG, PNG, etc.)
```

### Content Not Found

**Problem:** 404 error when accessing CID

**Solution:** Verify the CID was pinned:
```bash
# Upload and get CID
CID=$(curl -s -X POST --data-binary "test" http://localhost:4000/add | jq -r '.cid')

# Access via gateway (might take a moment)
curl http://localhost:4040/$CID

# If not found, file might not be pinned - re-upload
```

### CORS Errors

**Problem:** Browser blocks requests due to CORS

**Solution:** Gateway has CORS enabled. If still blocked:
```typescript
// Use your backend proxy
const imageUrl = `/api/files/${cid}`  // Your backend proxies to gateway
```

### Video/Audio Not Playing

**Problem:** Video/audio tags don't load

**Solution:** Ensure correct MIME type and browser support:
```typescript
// Check Content-Type header
curl -I http://localhost:4040/bafykrei...
# Should match the type in <video type="video/mp4">

// Common issues:
// - Wrong browser codec support (use WebM for broad support)
// - Range request not working (check if server supports 206 Partial Content)
```

## Advanced: Custom Gateway Wrapper

For complex file handling:

```typescript
class IPFSGateway {
  baseUrl: string

  constructor(baseUrl = 'http://localhost:4040') {
    this.baseUrl = baseUrl
  }

  /**
   * Get preview URL for a CID
   */
  getPreviewUrl(cid: string): string {
    return `${this.baseUrl}/${cid}`
  }

  /**
   * Fetch file metadata (size, type)
   */
  async getFileMetadata(cid: string) {
    const response = await fetch(`${this.baseUrl}/${cid}`, { method: 'HEAD' })
    return {
      cid,
      size: Number(response.headers.get('Content-Length')),
      mimeType: response.headers.get('Content-Type'),
      etag: response.headers.get('ETag'),
      lastModified: response.headers.get('Last-Modified'),
    }
  }

  /**
   * Download file with custom name
   */
  downloadFile(cid: string, filename: string): void {
    const link = document.createElement('a')
    link.href = this.getPreviewUrl(cid)
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  /**
   * Determine if CID is previewable (vs download-only)
   */
  isPreviewable(mimeType: string): boolean {
    const previewableMimes = [
      'image/', 'video/', 'audio/', 'application/pdf', 'text/',
    ]
    return previewableMimes.some(m => mimeType?.startsWith(m))
  }
}

// Usage
const gateway = new IPFSGateway()
const metadata = await gateway.getFileMetadata('bafykrei...')
console.log(`Type: ${metadata.mimeType}, Size: ${metadata.size}`)
```

## Testing the Integration

```bash
# 1. Upload a test image
CID=$(curl -s -X POST --data-binary @image.png http://localhost:4000/add | jq -r '.cid')

# 2. Verify gateway access
curl -I http://localhost:4040/$CID
# Should show Content-Type: image/png

# 3. Open in browser
open "http://localhost:4040/$CID"
# Should show image preview, not download dialog

# 4. Verify with different formats
curl -s -X POST --data-binary @video.mp4 http://localhost:4000/add | jq -r '.cid'
curl -s -X POST --data-binary @document.pdf http://localhost:4000/add | jq -r '.cid'
```

## Summary

**Quick Start:**
```typescript
// 1. Upload file
const cid = await uploadFile(file)

// 2. Display with correct tag
<img src={`http://localhost:4040/${cid}`} />

// 3. Done! Magic byte detection handles the rest
```

The gateway now properly:
- ✅ Detects file types from content
- ✅ Serves images with `image/*` MIME types
- ✅ Shows previews in browsers
- ✅ Supports all file types (video, audio, PDF, text, etc.)
- ✅ Works with both `/ipfs/` and direct CID paths
