# Sift

Streaming and resumable contact imports built with a Next.js dashboard, a NestJS API, a separate NestJS worker, PostgreSQL/Drizzle, and MinIO.

## Runtime boundaries

- `src/app` and `src/client` — Next.js dashboard.
- `src/server/api` — NestJS HTTP API.
- `src/worker` — independent NestJS worker process.
- `src/contracts` — framework-independent Zod contracts.
- `src/server/database` — PostgreSQL and Drizzle boundary.
- `src/server/storage` — S3-compatible object-storage boundary.

## Local setup

Requirements: Node.js 22+, npm, and Docker.

```bash
cp .env.example .env
npm ci
docker compose up -d
npm run db:migrate
```

Run each application in a separate terminal:

```bash
npm run dev
npm run dev:api
npm run dev:worker
```

- Dashboard: `http://localhost:3000`
- API liveness: `http://localhost:3001/health/live`
- API readiness: `http://localhost:3001/health/ready`
- MinIO console: `http://localhost:9001`

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
docker compose config
```
