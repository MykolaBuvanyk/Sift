# Sift

Streaming and resumable contact imports built with a Next.js dashboard, a NestJS API, a separate NestJS worker, PostgreSQL/Drizzle, and MinIO.

## Runtime boundaries

- `src/app` and `src/client` — Next.js dashboard.
- `src/app/api` — thin Next.js BFF that keeps the local Bearer token server-side.
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

For a production-like start with compiled containers, one-shot migrations, healthchecks, and
runtime hardening, see [Deployment and operations](docs/deployment.md).

Health endpoints are public. All current and future business endpoints are protected by default;
send `Authorization: Bearer <AUTH_BEARER_TOKEN>`. Ownership is always derived from
`AUTH_OWNER_ID` on the server and is never accepted from request metadata.

The browser calls same-origin `/api/imports/*` Route Handlers. They validate payloads, attach the
local `AUTH_BEARER_TOKEN` server-side, and stream only allowlisted response headers back to the
browser. `SIFT_API_URL` configures their NestJS upstream and defaults to `http://127.0.0.1:3001`.

## Import upload flow

1. `POST /imports` with `idempotency_key`, `format`, `filename`, and `declared_size_bytes`.
2. Upload the file directly to `upload_url` using `PUT` and every returned `upload_headers`
   value, including `If-None-Match: *`.
3. Call `POST /imports/:jobId/finalize` without a body.
4. Read current progress from `GET /imports/:jobId`.
5. Download row-level failures from `GET /imports/:jobId/errors`.

Minimal API example:

```bash
curl -X POST http://localhost:3001/imports \
  -H "Authorization: Bearer $AUTH_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  --data '{
    "idempotency_key": "contacts-2026-08-13",
    "format": "csv",
    "filename": "contacts.csv",
    "declared_size_bytes": 12345
  }'

# PUT the file to upload_url with every upload_headers value from the response,
# then replace <job-id> below.
curl -X POST http://localhost:3001/imports/<job-id>/finalize \
  -H "Authorization: Bearer $AUTH_BEARER_TOKEN"
curl http://localhost:3001/imports/<job-id> \
  -H "Authorization: Bearer $AUTH_BEARER_TOKEN"
```

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

CSV files use a header row. Required columns are `email` and `full_name`; optional columns are
`phone` and `tags`, in any order. Unknown or duplicate headers fail the job safely. Standard CSV
quoting supports commas, escaped quotes, CRLF/LF, and embedded newlines. `tags` accepts either a
JSON string array or a `|`-separated list. CSV resume re-reads only the bounded header, then opens
the data stream from the committed byte checkpoint.

The error endpoint returns an authenticated, owner-scoped NDJSON attachment ordered by source
line number. It uses bounded keyset pages and HTTP backpressure, so even a large report is not
materialized as one in-memory array.

The `/imports` dashboard implements this complete flow with TanStack Query. Polling runs only
while a job is non-terminal, upload bytes travel directly from the browser to MinIO, failed jobs
can resume from their checkpoint, and completed/failed jobs expose the streamed error report.

## Verification

```bash
npm run lint
npm run typecheck
npm test
npm run test:memory
npm run build
docker compose config
```

GitHub Actions runs these fast gates, a clean PostgreSQL/MinIO integration job, and both
production image builds. The separate `Memory stress` workflow processes one million NDJSON
and one million CSV rows on demand and every Monday.
