# Deployment and operations

## Clean production-like start

Requirements: Docker Engine with Compose v2.20+ and at least 2 GB of available memory.

```bash
cp .env.example .env
```

Before starting, replace `AUTH_BEARER_TOKEN`, `POSTGRES_PASSWORD`, `S3_ACCESS_KEY`, and
`S3_SECRET_KEY` with independent random values. Set `DASHBOARD_ORIGIN` and
`S3_PUBLIC_ENDPOINT` to browser-reachable HTTPS origins in a real deployment.

```bash
docker compose up --build --wait
```

The stack builds a single backend image used by the migration, API, and worker processes, plus
a separate Next.js standalone image. `migrate` and `bucket-init` are idempotent one-shot
services; API and worker do not start until both complete successfully.

The worker healthcheck is a readiness signal, not a PID check: it requires a recently updated
heartbeat written only after a successful database polling/processing iteration. Persistent
database, storage, or worker-loop failures therefore make the container unhealthy.

- Dashboard: `http://localhost:3000`
- API: `http://localhost:3001`
- Streaming upload gateway: `http://127.0.0.1:9000`
- PostgreSQL and the MinIO console are not published by the base stack.

Inspect lifecycle state and logs with:

```bash
docker compose ps
docker compose logs api worker migrate bucket-init
```

Stop containers without deleting imported data:

```bash
docker compose down
```

Deleting the named volumes is intentionally not included because it irreversibly deletes the
database and uploaded objects.

## Local Node.js development

Expose PostgreSQL and the MinIO console only on loopback, then run applications from Node.js:

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml \
  up -d --wait postgres minio storage-gateway
docker compose --env-file .env -f docker-compose.yml -f docker-compose.dev.yml run --rm bucket-init
npm run db:migrate
npm run dev
npm run dev:api
npm run dev:worker
```

## Runtime configuration

| Variable | Purpose |
| --- | --- |
| `AUTH_BEARER_TOKEN` | Server-side static API credential, minimum 32 characters. |
| `AUTH_OWNER_ID` | UUID used as the trusted owner identity. |
| `DASHBOARD_ORIGIN` | Exact browser origin accepted by API CORS. |
| `SIFT_API_URL` | Dashboard BFF to API URL; Compose sets it to the internal API name. |
| `DATABASE_URL` | PostgreSQL DSN; Compose derives an internal DSN. |
| `S3_ENDPOINT` | Internal S3-compatible endpoint used by API and worker. |
| `S3_PUBLIC_ENDPOINT` | Browser-reachable endpoint used to sign direct uploads. |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET` | Object-storage credentials and private bucket. |
| `IMPORT_MAX_BYTES` | Maximum accepted source object size. |
| `IMPORT_MAX_LINE_BYTES` | Maximum bounded NDJSON line or CSV logical record. |
| `IMPORT_BATCH_SIZE` | Maximum rows committed in one transaction. |
| `WORKER_LEASE_SECONDS` | Lease and stale-worker fencing duration. |

The remaining tuning variables and safe local values are documented in `.env.example` and
validated at process startup.

## Container security model

Application containers run as the unprivileged `node` user, with a read-only root filesystem,
all Linux capabilities dropped, `no-new-privileges`, bounded logs, CPU/memory limits, and only
explicit temporary filesystems. PostgreSQL and MinIO persist data in named volumes. MinIO stays
on the internal backend network. An unprivileged Nginx gateway publishes its S3 API on loopback,
preserves signed request headers, and disables request/response buffering for large uploads.

For a multi-host deployment, replace local MinIO with a managed/private S3-compatible service,
publish `S3_PUBLIC_ENDPOINT` through TLS, store secrets in the platform secret manager, and run
the migration image as a release job before rolling out API and workers.

## Verification and crash simulation

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev --audit-level=high
docker compose --env-file .env config --quiet
npm run test:memory
```

Crash/resume is covered twice. `tests/import-pipeline.acceptance.spec.ts` commits the first CSV
batch, lets its lease expire, reclaims the job with another worker token, and proves exact Range
resume. The production-stack CI additionally imports 100,000 rows, sends a real `SIGKILL` to the
worker after a committed checkpoint, restarts it after the lease expires, and verifies that the
job completes without duplicate contacts or counters.

`tests/e2e/import-stack.mjs` also proves request-key idempotency before and after completion plus
owner-scoped content-hash canonicalization for identical bytes uploaded under another key. The
S3 request deadline is cleared once `GetObject` response headers arrive, so it bounds connection
setup without aborting a healthy long-running response body.

CI separates fast quality checks, clean PostgreSQL/MinIO integration, production image builds,
the complete production Compose upload/finalize/worker flow, and the scheduled/manual million-row
end-to-end plus memory stress run.
