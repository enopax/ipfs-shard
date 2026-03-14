# Docker Setup for helia-shard

## Quick Start

### 1. Prerequisites

Ensure you have Docker and Docker Compose installed:
```bash
docker --version
docker-compose --version
```

### 2. Configure MinIO (S3 Storage)

Update your Docker Compose to create the required S3 buckets:

```yaml
minio-init:
  image: minio/mc:latest
  container_name: glashaus-minio-init
  depends_on:
    minio:
      condition: service_healthy
  entrypoint: >
    sh -c "
    mc alias set local http://minio:9000 minioadmin minioadmin &&
    mc mb local/glashaus-blocks --ignore-existing &&
    mc mb local/glashaus-data --ignore-existing &&
    echo 'MinIO buckets created successfully' &&
    exit 0
    "
```

### 3. Start Docker Services

From the parent **glashaus** directory:

```bash
docker-compose up -d
```

This starts:
- **MinIO** (S3 storage) on `http://localhost:9000`
- **MinIO Web Console** on `http://localhost:9001`
- **MongoDB** on port 27017
- **Prometheus** on port 9090

Verify MinIO is ready:
```bash
curl http://localhost:9000/minio/health/live
```

### 4. Start helia-shard (Local Development)

Ensure `.env` is configured with:
```bash
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=glashaus-blocks
S3_DATASTORE_BUCKET=glashaus-data
S3_REGION=eu-central-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
NODE_INTERNAL_PORT=3001
LOG_LEVEL=debug
```

Then start:
```bash
npm install
npm run dev
```

### 5. Verify Setup

Once running, test the server:

```bash
# Health check
curl http://localhost:3001/health

# List peers
curl http://localhost:3001/peers

# List connections
curl http://localhost:3001/connections
```

### 6. Access Services

- **helia-shard Internal API:** `http://localhost:3001`
- **MinIO Console:** `http://localhost:9001` (login: minioadmin/minioadmin)
- **MongoDB:** localhost:27017
- **Prometheus:** `http://localhost:9090`

### Docker Deployment

For production Docker deployment, use Docker service names:
```bash
# In docker-compose.yml, add helia-shard service:
helia-shard:
  image: node:24-slim
  container_name: glashaus-helia-shard
  working_dir: /app
  volumes:
    - ./js/helia-shard:/app
  environment:
    - S3_ENDPOINT=http://minio:9000
    - S3_BUCKET=glashaus-blocks
    - S3_DATASTORE_BUCKET=glashaus-data
    - S3_REGION=eu-central-1
    - AWS_ACCESS_KEY_ID=minioadmin
    - AWS_SECRET_ACCESS_KEY=minioadmin
    - NODE_INTERNAL_PORT=3001
    - LOG_LEVEL=info
  ports:
    - "3001:3001"    # Internal API
    - "4001:4001"    # libp2p TCP
    - "4002:4002"    # libp2p WebSocket
  depends_on:
    minio:
      condition: service_healthy
  command: npm start
```

## Service Communication

### Local Development (app outside Docker)
- Use `http://localhost:PORT` to reach Docker containers
- Example: `S3_ENDPOINT=http://localhost:9000`

### Docker Deployment (app inside Docker)
- Use Docker service names for inter-container communication
- Example: `S3_ENDPOINT=http://minio:9000`

## Environment Variables

| Variable | Local Dev | Docker | Description |
|----------|-----------|--------|-------------|
| `S3_ENDPOINT` | `http://localhost:9000` | `http://minio:9000` | MinIO S3 endpoint |
| `KUBO_ROUTING_URL` | `http://localhost:5001/routing/v1` | `http://kubo:5001/routing/v1` | Kubo delegated routing |
| `PORT` | `4000` | `4000` | API server port |
| `GATEWAY_PORT` | `8080` | `8080` | IPFS Gateway port |

## Troubleshooting

### Port Already in Use
If containers fail to start due to port conflicts:
```bash
docker-compose -f docker-compose.test.yml down
docker system prune -f
docker-compose -f docker-compose.test.yml up -d
```

### Services Not Reachable
- Local dev: Services must be running (`docker-compose ps`)
- Docker: Services must be on same network (automatic with docker-compose)

### Check Service Health
```bash
docker-compose -f docker-compose.test.yml ps
docker logs glashaus-minio
docker logs glashaus-kubo
```
