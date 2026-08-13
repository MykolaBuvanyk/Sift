# Sift

Streaming and resumable contact imports built with a Next.js dashboard, a NestJS API, a separate NestJS worker, PostgreSQL/Drizzle, and MinIO.

## Runtime boundaries

- `src/app` and `src/client` — Next.js dashboard.
- `src/server/api` — NestJS HTTP API.
- `src/worker` — independent NestJS worker process.
- `src/contracts` — framework-independent Zod contracts.
- `src/server/database` — PostgreSQL and Drizzle boundary.
- `src/server/storage` — S3-compatible object-storage boundary.
- `src/server/core/auth` — default-deny static Bearer authentication and trusted owner context.
- `src/server/core/http` — validation, stable errors, request IDs, CORS, body limits, and redacted logs.

## Local setup

Requirements: Node.js 22+, npm, and Docker.

```bash
cp .env.example .env
# Replace AUTH_BEARER_TOKEN with a random value of at least 32 characters.
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

Health endpoints are public. All current and future business endpoints are protected by default;
send `Authorization: Bearer <AUTH_BEARER_TOKEN>`. Ownership is always derived from
`AUTH_OWNER_ID` on the server and is never accepted from request metadata.

## Import upload flow

1. `POST /imports` with `idempotency_key`, `format`, `filename`, and `declared_size_bytes`.
2. Upload the file directly to `upload_url` using `PUT` and every returned `upload_headers`
   value, including `If-None-Match: *`.
3. Call `POST /imports/:jobId/finalize` without a body.
4. Read current progress from `GET /imports/:jobId`.

Failed finalized jobs can be resumed with `POST /imports/:jobId/retry`. Retry reuses the same
job and preserves its byte/line checkpoint and counters. Retrying a completed job is an
idempotent `200` no-op with `retried: false`; pending or running jobs return `409`.

The API never receives the source bytes. Finalize verifies MinIO metadata and computes SHA-256
from a stream before making the job visible to the worker. Unfinalized reservations expire and
are removed automatically.

The worker claims jobs through PostgreSQL `FOR UPDATE SKIP LOCKED`, reads the source with a
Range request from the last committed byte checkpoint, and commits contacts, row errors,
counters, checkpoint, and lease heartbeat in one transaction. Lease tokens fence stale workers;
replayed checkpoints are idempotent and transient storage failures return the job to `pending`.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run build
docker compose config
```
