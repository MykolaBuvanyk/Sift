# Sift — відповідність тестовому завданню

Дата перевірки: 2026-08-13.

## Висновок

Тестове завдання реалізоване повністю: 10/10 пунктів Definition of Done і всі обов'язкові
категорії тестів мають автоматизований доказ. NDJSON є основним форматом; CSV, dashboard,
direct signed upload, cleanup reservations і production container hardening реалізовані понад
мінімальний scope.

## Definition of Done

| # | Статус | Реалізація та доказ |
| --- | --- | --- |
| 1 | ✅ | `byte-line-reader.ts`, `ndjson-parser.ts` і `csv-record-reader.ts` читають потоки інкрементально. `npm run test:memory` обробляє по 1 млн NDJSON/CSV рядків під `--max-old-space-size=192`. |
| 2 | ✅ | Async iteration і один послідовний batch забезпечують backpressure; batch і logical row мають конфігуровані bounds. Peak RSS delta: 156.8 MB NDJSON / 146.2 MB CSV. |
| 3 | ✅ | `ImportWorkerRepository.commitBatch()` виконує bounded transaction, job-local dedup і `ON CONFLICT`; `(owner_id, lower(email))` є фінальним DB guard. |
| 4 | ✅ | Zod validation створює bounded `import_row_errors`; mixed production-stack E2E завершився з 94,118 imported і 5,882 failed. |
| 5 | ✅ | `GET /imports/:id/errors` віддає owner-scoped NDJSON через `Readable` і keyset pages, не матеріалізуючи весь звіт. |
| 6 | ✅ | API лише створює/finalize-ить job; окремий Nest application context `worker` забирає її у фоні. Статус доступний через `GET /imports/:id`. |
| 7 | ✅ | Byte/line checkpoint комітиться в тій самій transaction, що contacts/errors/counters. Worker відкриває S3 Range від `processed_bytes`. |
| 8 | ✅ | Lease token fencing, exact checkpoint replay і DB counter check не дозволяють подвійний commit. Реальний SIGKILL E2E успішно завершив 100,000-row import після reclaim. |
| 9 | ✅ | `(owner_id, idempotency_key)` повертає ту саму job; server-side SHA-256 + advisory transaction lock канонізують однаковий content під іншим ключем. Stack E2E перевіряє обидва випадки. |
| 10 | ✅ | Claim використовує `FOR UPDATE SKIP LOCKED`; expired `running` job отримує новий lease token. Integration test доводить concurrent claim/fencing, stack E2E — TTL recovery після SIGKILL. |

## Обов'язкові тести

| Категорія з задачі | Автоматизований доказ |
| --- | --- |
| Unit: validation, boundaries, dedup, counters | Vitest parser/contract/batch/repository suites; загалом 26 files / 75 tests. |
| Large E2E 1–5 млн | Локально пройдено 1,000,000 generated NDJSON rows через API → MinIO → worker → PostgreSQL: 1,000,000 imported, 0 failed/duplicates, 149,777,792 bytes. Той самий сценарій є у scheduled/manual CI. |
| Mixed valid/invalid | Production-stack 100,000-row test перевіряє imported/failed counters та кількість рядків streamed error report. |
| Crash + resume | Production-stack test надсилає контейнеру worker реальний `SIGKILL` після ненульового checkpoint, відновлює restart policy/process і очікує TTL reclaim до exact completion. |
| Idempotency | Stack test повторює той самий request key до upload і після completion, а також завантажує ті самі bytes під іншим key та отримує canonical job. |

## Остання верифікація

- `npm run lint` — успішно;
- `npm run typecheck` — успішно;
- `npm test` — 26/26 files, 75/75 tests;
- `npm run build` — NestJS API/worker/contracts і Next.js production build успішні;
- `npm audit --omit=dev` — 0 vulnerabilities;
- `npm run test:memory` — 1 млн NDJSON + 1 млн CSV без OOM;
- production Compose — усі runtime services healthy;
- production-stack E2E — 100k mixed + real crash/resume та 1 млн happy path успішні.

## Поза scope задачі

Для публічного multi-user production залишаються продуктові рішення, яких тестове завдання не
вимагає: identity provider замість дозволеного static single-owner token, distributed rate
limiting/quotas, політика retention для PII/error excerpts і конкретний cloud secret manager/TLS
ingress. Вони не впливають на відповідність поточному scope, але є умовами публічного запуску.
