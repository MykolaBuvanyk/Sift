# Security Best-Practices Review

## Executive summary

The complete import path has no identified critical or high-severity vulnerability. PostgreSQL
queries are parameterized, object ownership originates from server-created job rows, lease UUIDs
fence stale workers, batch writes are atomic, parser memory is bounded, provider errors are
sanitized, and production dependencies currently report zero known vulnerabilities.

The remaining findings are deployment/product hardening items. The static Bearer model is suitable
for the documented local/single-owner scope but must not become the production multi-user auth
model. Expensive import endpoints also need distributed rate limits before public deployment.

The final hardening pass removed a long-stream availability defect: S3 request deadlines now
bound only response establishment and are cleared after `GetObject` headers arrive, so a healthy
multi-minute response body is not aborted by the short control-plane timeout. Worker readiness
now depends on a successful-iteration heartbeat instead of a PID-only check. API, cleanup, and
database diagnostics use an allowlisted error-name projection; full messages, stacks, and nested
causes are never passed to the logger.

## Critical severity

No findings.

## High severity

No findings.

## Medium severity

### SIFT-SEC-001 — Static Bearer token represents one configured owner

- **Location:** `src/server/core/auth/bearer-token.guard.ts:34-47` and
  `src/app/api/_lib/sift-api-proxy.ts`
- **Evidence:** Every valid request receives `AUTH_OWNER_ID`; the token has no per-user identity,
  expiry, rotation record, revocation state, or audience.
- **Impact:** If this local authentication model were deployed as a multi-user service, every
  holder of the shared token would act as the same owner and token compromise would affect the
  entire deployment.
- **Fix:** Before production/multi-user rollout, replace it with verified short-lived JWTs or
  server-side sessions and derive `ownerId` from the authenticated subject. Preserve the current
  owner-scoped repository predicates.
- **Mitigation:** Keep the current API private/local, provide the token only through runtime
  secrets, rotate it on disclosure, and retain the constant-time comparison. The dashboard BFF
  keeps the token out of the browser bundle, URLs, and browser request headers, but its public
  Route Handlers still represent the configured local owner and need real sessions in production.
- **False-positive notes:** This is explicitly documented as a static local-scope auth model, so
  it is not a blocker for the current assignment stage.

### SIFT-SEC-002 — Expensive import mutations have no visible rate limiter

- **Location:** `src/server/modules/imports/import.controller.ts:31-66` and
  `src/server/modules/imports/import.service.ts:65-104`
- **Evidence:** Create, finalize, and retry are authenticated and size-bounded, but there is no
  per-owner/IP request quota. Finalize streams and hashes the uploaded object.
- **Impact:** A valid token holder can repeatedly reserve objects or invoke expensive hashing,
  consuming PostgreSQL, MinIO, network, and CPU capacity.
- **Fix:** Add a distributed limiter at the gateway or Redis/PostgreSQL boundary, keyed by owner
  and route. Apply stricter quotas to create/finalize and cap outstanding non-terminal jobs.
- **Mitigation:** Keep the service private until the limiter and deployment-level request limits
  are configured.
- **False-positive notes:** A reverse proxy or platform limiter may exist outside this repository;
  verify deployment configuration before treating this as unfixed.

## Low severity

### SIFT-SEC-003 — Invalid-row excerpts can contain personal data

- **Location:** `src/worker/imports/ndjson-parser.ts:104-150` and
  `src/server/database/schema.ts:118-137`
- **Evidence:** The first bounded portion of an invalid row is intentionally persisted as
  `raw_excerpt` to support the required error report.
- **Impact:** Email addresses, phone numbers, or other supplied fields may remain in PostgreSQL
  after processing and increase the impact of database access or overly broad report access.
- **Fix:** Define retention/deletion for jobs and row errors, and consider field-aware redaction
  if product diagnostics permit it.
- **Mitigation:** Excerpts are bounded to 500 UTF-8 bytes in application code and by a database
  constraint; they are not written to logs. Stage 9 report reads are owner-scoped both before
  streaming and in every bounded page query.
- **False-positive notes:** Persistence is an explicit assignment requirement, so removing the
  excerpt outright would break the requested contract.

## Controls verified

- Owner-scoped API reads and mutations return safe not-found semantics.
- The streaming error report repeats the owner predicate on every keyset page, uses bounded
  memory, and stops its source stream on HTTP disconnect.
- Worker storage keys and owner IDs come from server-created database rows, not job payloads from
  an untrusted queue.
- Every batch write is inside one PostgreSQL transaction.
- Active `lease_token` plus lease expiry fence stale workers on commit, completion, and failure.
- Checkpoints and counters have database checks; row-error strings and excerpts have database
  bounds.
- NDJSON lines and batches are bounded; no unbounded `Promise.all` is used.
- CSV records and batches are bounded; quoted multiline records retain only a configured prefix
  after the byte limit, and resume re-reads a bounded header before the checkpoint Range stream.
- Logs omit row contents, storage keys, credentials, tokens, provider exception messages, stacks,
  and nested causes; regression tests verify the sanitized payload boundary.
- Worker diagnostics contain only bounded job IDs, stable failure codes, and error class names.
- API authorization uses constant-time token comparison and log redaction.
- The dashboard BFF validates inputs and upstream contracts, keeps the Bearer token server-side,
  disables caching for job state, and streams error reports without buffering them into blobs.
- CORS allowlists one configured origin and does not enable credentials.
- Express fingerprinting is reduced by disabling `x-powered-by`.
- `npm audit --omit=dev`: zero known production dependency vulnerabilities on 2026-08-13.
- Production app images run as non-root with read-only roots, all capabilities dropped,
  `no-new-privileges`, healthchecks, resource bounds, and bounded log rotation.
- PostgreSQL and MinIO stay on an internal network; the loopback-only unprivileged storage
  gateway preserves signed headers and disables buffering for direct large-file uploads.

## Verdict

Approved for the current local assignment stage after the implemented fixes. Production/public
deployment remains conditional on SIFT-SEC-001 and SIFT-SEC-002 being resolved or explicitly
provided by trusted infrastructure.
