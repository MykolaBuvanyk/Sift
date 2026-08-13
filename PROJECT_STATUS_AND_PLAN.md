# Sift — поточний стан і план реалізації

## 1. Мета проєкту

Sift — full-stack застосунок для потокового імпорту великих NDJSON/CSV-файлів із контактами.

Головні інваріанти завдання:

- файл не завантажується цілком в оперативну пам'ять;
- worker працює з bounded memory і backpressure;
- записи обробляються обмеженими batch-ами;
- невалідний рядок не зупиняє весь import;
- прогрес і лічильники зберігаються атомарно;
- після падіння worker продовжує з останнього checkpoint;
- повторний запит або повторна обробка не створює дублів;
- дві копії worker не обробляють одну job одночасно;
- звіт про помилки не матеріалізується повністю в пам'яті.

## 2. Архітектурні межі

```text
src/app       -> Next.js App Router dashboard
src/client    -> браузерні features, entities і page modules
src/contracts -> спільні Zod-контракти без прив'язки до framework
src/server    -> NestJS API, бізнес-модулі та infrastructure
src/worker    -> окремий NestJS background process
drizzle       -> PostgreSQL migrations
tests         -> integration та E2E-сценарії
```

Runtime-процеси:

```text
Browser -> Next.js dashboard -> NestJS API -> PostgreSQL
                               |          -> MinIO
                               |
                               + job status

NestJS worker -> PostgreSQL job queue
NestJS worker -> MinIO Range stream
NestJS worker -> PostgreSQL batch transactions
```

Напрям залежностей:

```text
app -> client -> contracts
server/api -> server/modules -> database/storage -> external systems
worker -> server/modules/repositories -> database/storage
contracts -> zod only
```

## 3. Що вже виконано

### Етап 0 — архітектурний каркас — завершено

- створено окремий проєкт `/Users/admin/Desktop/Sift`;
- ініціалізовано Git-репозиторій із гілкою `main`;
- розділено dashboard, API, worker і contracts за runtime;
- обрано PostgreSQL queue замість Redis/BullMQ;
- обрано MinIO як локальне S3-сумісне object storage;
- зафіксовано Node.js 22 через `.nvmrc` та `engines`;
- створено npm workspaces для `@sift/server` і `@sift/contracts`.

### Етап 1 — базова платформа — завершено

- встановлено Next.js 16.3, React 19.2 і TypeScript;
- створено мінімальний dashboard із маршрутами `/` та `/imports`;
- встановлено NestJS 11;
- створено незалежний NestJS HTTP entrypoint `src/server/api/main.ts`;
- створено незалежний worker entrypoint `src/worker/main.ts` без HTTP-сервера;
- додано API liveness endpoint `GET /health/live`;
- додано boot-time Zod-валідацію environment variables;
- налаштовано ESLint, Vitest і TypeScript для всіх runtime-частин;
- встановлено AWS S3 SDK для майбутньої інтеграції з MinIO;
- встановлено PostgreSQL driver і Drizzle ORM/Kit;
- створено початкові Zod-контракти `Contact` та `ImportFormat`;
- додано один стартовий unit-тест контракту контакту.

### Етап 2 — database та storage foundation — завершено

- додано Docker Compose із PostgreSQL 17 та MinIO;
- додано healthchecks, localhost-only ports і named volumes;
- створено `.env.example`;
- описано Drizzle tables `import_jobs`, `contacts`, `import_row_errors`;
- створено ключ `(owner_id, idempotency_key)` для ідемпотентності job;
- створено ключ `(owner_id, email)` для дедуплікації контактів;
- створено worker eligibility index;
- додано runtime `DatabaseModule` з одним Drizzle client поверх `pg.Pool` для кожного process;
- налаштовано окремі pool limits для API/worker, connect/statement timeouts і graceful shutdown;
- додано `lease_token`, `uploaded_at`, state/counter/byte checks та indexes для claim/status;
- `content_hash` обчислюється під час finalize; до `uploaded_at` він залишається `NULL`;
- зафіксовано normalized lowercase email і case-insensitive uniqueness;
- додано `StorageModule`/`StorageService`: opaque owner-prefixed keys, presigned PUT, HEAD і Range stream;
- додано bounded S3 timeouts і нормалізовані storage errors;
- додано one-shot `minio-init`, який створює bucket `sift-imports`;
- додано `GET /health/ready` з реальними PostgreSQL/MinIO checks і draining semantics;
- згенеровано та застосовано migrations до чистої локальної PostgreSQL.

### Виконані перевірки

- `npm ci` під Node.js 22 — успішно;
- `npm run lint` — успішно;
- `npm run typecheck` — успішно;
- `npm test` — 68/68;
- `npm run test:memory` — 1,000,000 NDJSON + 1,000,000 CSV rows під 192 MB heap;
- `npm run build` — contracts, NestJS backend/worker і Next.js успішно;
- `npm run db:generate` — migration згенеровано;
- `docker compose config` — валідний;
- API smoke test `GET /health/live` — `{"status":"ok"}`;
- API smoke test `GET /health/ready` — PostgreSQL і MinIO `ok`.

### Відоме технічне попередження

`npm audit` показує 4 moderate dev-only vulnerabilities у транзитивному старому `esbuild`, який входить у стабільний `drizzle-kit@0.31.10`. Production dependencies не зачеплені. `npm audit fix --force` не застосовано, тому що npm пропонує небезпечний downgrade Drizzle Kit. Потрібно повторно перевірити після стабілізації Drizzle Kit 1.x.

## 4. Що ще не реалізовано функціонально

Після завершення CSV pipeline та етапу 11 залишаються production Docker images, повний CI
integration stack, deployment hardening і фінальна документація етапу 12.

## 5. Точний план наступних етапів

### Етап 3 — auth, contracts та API foundation — завершено

#### 3.1 Мінімальна auth-модель

- використати статичний Bearer token відповідно до scope guard завдання;
- token конфігурується через environment;
- guard визначає server-side `ownerId`;
- заборонити приймати `ownerId` з body/query;
- усі repository queries фільтрувати за `owner_id`.

Реалізовано: auth працює default-deny через global guard, health routes явно позначені
`@Public()`, а trusted owner context формується лише з `AUTH_OWNER_ID`. У наступних етапах
repository methods мають обов'язково приймати цей context і включати `owner_id` у кожен query.

#### 3.2 API contracts

- додати strict Zod/class-validator DTO для створення import;
- додати contracts для job status і progress;
- додати contract для error-report row;
- додати contract для retry;
- додати стабільний error response `{ code, message, details?, traceId }`;
- додати global validation pipe та exception filter.

#### 3.3 HTTP foundation

- додати request/correlation ID;
- додати structured logging із redaction;
- налаштувати CORS лише для dashboard origin;
- встановити body/metadata limits;
- не використовувати body parser для великих source bytes.

Критерій готовності:

- незахищені import endpoints повертають `401`;
- owner identity неможливо підмінити через request;
- невалідні DTO повертають стабільний `400` contract;
- секрети й authorization headers не потрапляють у logs.

Реалізовано та покрито тестами: strict DTO/Zod contracts відхиляють ownership fields,
Bearer guard повертає `401`, validation/filter формують стабільні errors, request logger
створює/повертає `X-Request-ID` і редагує auth/cookie/token/secret fields. API приймає лише
metadata body до `API_BODY_LIMIT_BYTES`; великі source bytes мають йти direct-to-MinIO на етапі 4.

### Етап 4 — створення import job і upload flow — завершено

Рекомендований варіант: direct-to-MinIO presigned upload, тому що він не проводить великі bytes через API.

#### 4.1 Створення reservation/job

- реалізувати `POST /imports`;
- приймати `idempotency_key`, format, filename hint і declared size;
- перевіряти supported format та size limit;
- генерувати `job_id` і opaque storage key;
- ідемпотентно повертати існуючу job для того самого `(owner_id, idempotency_key)`;
- при повторі ключа з іншими metadata повертати `409`;
- повернути короткоживий presigned upload URL.

#### 4.2 Finalize upload

- реалізувати `POST /imports/:id/finalize` як необхідний технічний крок;
- виконати Storage HEAD;
- перевірити фактичний size;
- обчислити SHA-256 потоково на сервері/worker, не довіряти client hash;
- лише після успішної перевірки зробити job доступною worker;
- зробити finalize ідемпотентним.

#### 4.3 Cleanup

- очищати прострочені незавершені reservations і orphan objects;
- не видаляти object, який уже належить running/completed job.

Критерій готовності:

- великий файл завантажується browser -> MinIO без проходження через RAM API;
- повторний idempotency key не створює другу job;
- worker не може claim job до завершення upload;
- metadata та object ownership перевіряються server-side.

Реалізовано: `POST /imports` створює owner-scoped reservation і повертає короткоживий
conditional presigned `PUT`; повторний idempotency key повертає ту саму job, а інші metadata
дають `409`. `POST /imports/:id/finalize` виконує `HEAD`, звіряє size/content type, потоково
обчислює SHA-256 і лише тоді встановлює `uploaded_at`, тому worker index не бачить
незавершені upload. Finalize є ідемпотентним. Expired reservations атомарно claim-яться через
`FOR UPDATE SKIP LOCKED`, після чого cleanup видаляє object і DB row; stale claims
відновлюються після timeout. MinIO CORS обмежений `DASHBOARD_ORIGIN`.

### Етап 5 — status, retry та owner-safe queries

Статус: **реалізовано**.

#### 5.1 Status endpoint

- реалізувати `GET /imports/:id`;
- повертати status, counters, processed/total bytes і percent;
- обчислювати percent без ділення на нуль;
- повертати `404` для чужого або неіснуючого ID.

#### 5.2 Retry endpoint

- реалізувати `POST /imports/:id/retry`;
- дозволяти retry лише `failed` job;
- не скидати committed checkpoint і counters;
- робити retry completed job ідемпотентним no-op або `409` — зафіксувати contract;
- не дозволяти retry job із чинним lease.

Критерій готовності:

- owner бачить лише власну job;
- progress contract стабільний;
- retry не створює нову job і не обнуляє підтверджений прогрес.

Реалізовано: `GET /imports/:id` повертає owner-scoped стабільний progress contract і `404`
для чужого/неіснуючого ID. Percent обмежений діапазоном `0..100`, рахується до двох знаків
і не ділить на нуль. `POST /imports/:id/retry` атомарно переводить лише finalized `failed`
job у `pending` без зміни checkpoint/counters. Для `completed` зафіксовано ідемпотентний
`200` no-op (`retried: false`), для `pending`/`running` — `409 IMPORT.RETRY_NOT_ALLOWED`.

### Етап 6 — потокові NDJSON/CSV parsers

Статус: **реалізовано та перевірено**.

#### 6.1 Byte line reader

- приймати Node `Readable`/Web Stream;
- декодувати UTF-8 інкрементально;
- зберігати лише незавершений рядок;
- коректно обробляти `LF`, `CRLF` і останній рядок без newline;
- вести точний byte offset, а не JS character count;
- checkpoint ставити тільки після повного delimiter;
- встановити `MAX_LINE_BYTES`.

#### 6.2 Per-row parsing і validation

- виконувати `JSON.parse` лише одного рядка;
- перевіряти кожен запис через `contactSchema`;
- нормалізувати email;
- обрізати `raw_excerpt` до 500 символів/bytes;
- класифікувати parse і validation errors стабільними codes;
- не зупиняти stream через один невалідний рядок.

#### 6.3 Batching і backpressure

- формувати batch максимум 500–1000 рядків;
- тримати не більше одного незакоміченого batch на першій реалізації;
- читати наступний batch лише після database commit попереднього;
- не використовувати unbounded `Promise.all`;
- зробити batch size configurable із безпечними bounds.

Критерій готовності:

- unit-тести доводять, що chunk boundary не розрізає logical row;
- peak memory не росте пропорційно розміру source file;
- битий рядок повертається як row error, а parser продовжує роботу.

Реалізовано framework-independent async parser у `src/worker/imports`: bounded byte line
reader підтримує Node/Web streams, chunk boundaries, `LF`, `CRLF`, EOF line, абсолютні byte
checkpoints і oversized lines без накопичення всього рядка. NDJSON parser нормалізує email,
валідує кожен рядок через `contactSchema`, повертає стабільні row error codes та формує
backpressure-aware batches до 1000 рядків. `IMPORT_MAX_LINE_BYTES` і `IMPORT_BATCH_SIZE`
мають bounds у startup environment schema. Unit-тести покривають UTF-8 chunk boundaries,
`LF`/`CRLF`, EOF line, oversized rows, parsing/validation errors і bounded excerpts.

#### 6.4 CSV extension — завершено

Додано bounded byte-level CSV record reader із підтримкою `LF`/`CRLF`, quoted commas,
escaped quotes, embedded newlines, UTF-8 chunk boundaries та EOF record. Header вимагає
`email`/`full_name`, дозволяє опційні `phone`/`tags` у довільному порядку і відхиляє duplicate
або unknown columns. Row-level syntax/schema errors не зупиняють import. На resume worker
перечитує окремим bounded stream лише header mapping, а data Range відкриває з committed byte
checkpoint. Repository claim і dashboard активовані для `csv`; tags приймають JSON array або
`|`-розділений список.

### Етап 7 — PostgreSQL job queue, lease та recovery

Статус: **реалізовано**.

#### 7.1 Claim

- вибирати `pending` або прострочену `running` job;
- використовувати коротку transaction із `FOR UPDATE SKIP LOCKED`;
- генерувати новий `lease_token`;
- встановлювати `claimed_at`, `lease_expires_at`, status `running`;
- гарантувати, що concurrent workers отримують різні jobs.

#### 7.2 Heartbeat/fencing

- поновлювати lease після кожного committed batch;
- кожен update перевіряє `job_id + lease_token`;
- старий worker після втрати lease не може оновити job;
- heartbeat failure зупиняє читання stream.

#### 7.3 Graceful shutdown і recovery

- worker перестає claim нові jobs після SIGTERM;
- завершує поточну transaction або безпечно відпускає job;
- після crash інший worker reclaim-ить прострочений lease;
- worker відкриває Range stream із committed `processed_bytes`;
- retry/recovery не починає import з нуля.

Критерій готовності:

- два workers не обробляють одну job одночасно;
- stale worker не може commit після takeover;
- kill/restart продовжує import із committed checkpoint.

Реалізовано: worker атомарно claim-ить `pending` або expired `running` NDJSON job через
`FOR UPDATE SKIP LOCKED`, видає новий UUID fencing token та читає MinIO Range stream від
committed `processed_bytes`. Кожен batch commit, completion і failure перевіряє чинний
`lease_token` та expiry. Shutdown припиняє polling, перериває stream і безпечно повертає
job у `pending`; transient storage failures також release-ять job для recovery.

### Етап 8 — атомарний batch commit і точні counters

Статус: **реалізовано**.

#### 8.1 Batch classification

- визначити й зафіксувати точну семантику `imported`, `duplicate`, `failed`;
- дедуплікувати однакові emails у batch;
- дедуплікувати повтори між batch-ами того самого job;
- перевіряти існуючі contacts owner-а;
- використовувати `(owner_id, email)` як фінальний database guard.

#### 8.2 Одна transaction на batch

- вставити нові contacts;
- записати `import_row_errors`;
- збільшити imported/failed/duplicate counters;
- оновити `processed_bytes` і `last_line_number`;
- поновити lease;
- перевірити expected previous checkpoint і lease token;
- rollback усього batch при будь-якій помилці.

#### 8.3 Completion

- після EOF перевірити counter invariant;
- встановити `completed` і `finished_at`;
- звільнити lease fields;
- при permanent failure встановити `failed` зі sanitized error metadata.

Основний інваріант:

```text
last_line_number = imported_count + failed_count + duplicate_count
```

Критерій готовності:

- повторний commit того самого checkpoint не подвоює contacts, errors або counters;
- crash до commit не залишає часткові дані;
- crash після commit resume-иться з наступного рядка.

Реалізовано: одна PostgreSQL transaction записує contacts, row errors, durable per-job
dedup markers, counters, byte/line checkpoint і lease heartbeat. `(owner_id, email)` лишається
фінальним concurrency guard; `import_job_seen_contacts` відрізняє duplicates між batch-ами
того самого job. Exact checkpoint replay є no-op, а DB check гарантує
`last_line_number = imported_count + failed_count + duplicate_count`. Completion/failure
очищають lease fields і записують bounded sanitized failure metadata.

### Етап 9 — потоковий error report — завершено

Статус: **реалізовано та перевірено**.

#### 9.1 Repository read

- читати errors у порядку `(line_number)`;
- використовувати cursor/keyset pagination або PostgreSQL cursor;
- вибирати обмежену кількість rows за раз;
- завжди фільтрувати job через `owner_id`.

#### 9.2 HTTP stream

- реалізувати `GET /imports/:id/errors`;
- віддавати NDJSON або CSV stream;
- встановити правильний `Content-Type` і `Content-Disposition`;
- поважати response backpressure;
- закривати database cursor при disconnect/error;
- не створювати один великий array або JSON response.

Критерій готовності:

- звіт із великою кількістю errors має bounded memory;
- disconnect клієнта звільняє cursor/connection;
- чужий job повертає `404`.

Реалізовано: `GET /imports/:id/errors` до відправлення заголовків перевіряє owner-scoped job
і повертає однаковий `404` для чужого та неіснуючого ID. `import_row_errors` читаються у
порядку `line_number` keyset-сторінками по 250 рядків; кожен batch-запит повторно містить
`owner_id`, тому перевірка не залежить лише від початкового lookup. Відповідь —
`application/x-ndjson` attachment, побудований через Node `Readable`/Nest `StreamableFile`:
Express pipe поважає backpressure, весь звіт не матеріалізується у пам'яті, а disconnect
знищує source stream. Довготривалий database cursor/connection не утримується між batch-ами.

### Етап 10 — dashboard — завершено

Статус: **реалізовано та перевірено у браузері**.

#### 10.1 Client foundation

- додати typed API client;
- додати TanStack Query provider;
- тримати server state у Query, а не дублювати в Zustand;
- додати Bearer token для локального scope.

#### 10.2 Create import UI

- форма вибору NDJSON/CSV файла;
- client-side prevalidation лише як UX, не як security boundary;
- створення job;
- direct upload у MinIO через presigned URL;
- finalize;
- progress/error states для кожної фази.

#### 10.3 Progress UI

- polling лише для non-terminal jobs;
- автоматично зупиняти polling після completed/failed;
- показувати counters, bytes і percent;
- кнопка retry для failed job;
- посилання на streaming error report.

Критерій готовності:

- користувач проходить повний flow через browser;
- dashboard не імпортує server modules;
- polling не працює для terminal jobs;
- UI коректно показує partial failures.

Реалізовано: `/imports` лишається тонкою Server Component сторінкою, а інтерактивний workspace
винесено у feature-based client boundary. TanStack Query володіє server state, polling працює
кожні 1.5 секунди лише для non-terminal job і автоматично вимикається для `completed/failed`.
Typed client валідує metadata та кожну JSON-відповідь спільними Zod-контрактами. Upload іде
напряму з браузера у MinIO через presigned conditional `PUT`, показує progress, після чого UI
викликає finalize та відображає bytes, percent, усі counters, partial completion, retry і звіт.
CSV control активовано після підключення CSV parser/worker path; реальний browser smoke довів
quoted/multiline CSV flow із точними counters та streaming error report.

Bearer token не включається у client bundle і URL: thin Next.js BFF у `src/app/api` валідує
вхідні payload/UUID, додає token server-side, не кешує job state та allowlist-ить response
headers. Error report проксіюється як Web Stream без проміжного `blob`/масиву. Browser smoke
довів повний NDJSON flow: 4 рядки дали 2 imports, 1 duplicate, 1 error, 100% і робочий download.

### Етап 11 — обов'язкові тести — завершено

Статус: **реалізовано та перевірено**.

#### 11.1 Unit

- contact validation;
- NDJSON chunk/line boundary;
- UTF-8 byte checkpoint;
- batch deduplication;
- counter reconciliation;
- retry/backoff/state transitions;
- raw excerpt truncation.

#### 11.2 Integration

- Drizzle migrations на чистій PostgreSQL;
- idempotent job creation;
- concurrent `SKIP LOCKED` claim;
- stale lease fencing;
- atomic batch commit;
- owner isolation;
- Range stream із MinIO.

#### 11.3 E2E

- happy path із великим generated file;
- mixed valid/invalid rows;
- duplicate rows усередині файла і проти DB;
- crash + resume;
- повторний idempotency key;
- два concurrent workers;
- streaming error report;
- API auth і foreign-owner boundaries.

#### 11.4 Memory/stress

- генерувати 1–5 млн рядків під час тесту, не комітити fixture;
- запускати worker із заданим `--max-old-space-size`;
- записувати peak RSS;
- перевіряти, що RSS не росте лінійно з file size;
- винести довгий stress test в окремий CI job.

Критерій готовності:

- усі acceptance scenarios із задачі мають автоматичний доказ;
- crash/resume не створює дублів і не подвоює counters;
- large-file test завершується без OOM.

Реалізовано: unit-тести покривають NDJSON/CSV chunk і logical-record boundaries, UTF-8,
quoted/multiline CSV, header validation, stable row errors, oversized records, dedup та failure
policy. PostgreSQL integration доводить concurrent `SKIP LOCKED`, stale lease fencing, atomic
commit/replay та claim обох форматів. Acceptance test комітить generated 5k NDJSON batches і
симулює CSV crash після першого commit, lease takeover, Range resume з окремим header mapping та
completion без повторних contacts/counters. Наявні HTTP E2E перевіряють auth, owner isolation і
streaming report; browser smoke перевірив реальні API → MinIO → worker flows для NDJSON і CSV.

Окремий `npm run test:memory` генерує дані на льоту без fixtures і в ізольованих процесах
обробляє по 1,000,000 NDJSON та CSV rows з `--max-old-space-size=192`. Зафіксований peak RSS
delta: 147.6 MB для NDJSON і 146.3 MB для CSV; обидва завершилися без OOM.

### Етап 12 — Docker, CI та фінальне завершення

#### 12.1 Docker

- додати multi-stage Dockerfile;
- один backend image запускати командами API або worker;
- окремий standalone Next.js image;
- додати migration one-shot service;
- додати bucket-init one-shot service;
- API/dashboard публічні, worker/PostgreSQL/MinIO — у внутрішній мережі;
- non-root, read-only root filesystem, dropped capabilities;
- resource limits і healthchecks.

#### 12.2 CI

- Node.js 22 і `npm ci`;
- lint, typecheck, unit tests;
- production builds;
- clean PostgreSQL/MinIO integration stack;
- migrations;
- integration/E2E;
- dependency audit;
- окремий memory stress workflow.

#### 12.3 Документація

- setup від чистого clone;
- environment variables;
- Docker запуск;
- API examples;
- формат NDJSON/CSV;
- алгоритм checkpoint/resume;
- duplicate semantics;
- crash simulation;
- verification commands.

#### 12.4 Фінальне рев'ю

- перевірити кожен Definition of Done пункт задачі;
- виконати code-quality, security, NestJS, React і Docker review;
- перевірити clean install і clean database;
- перевірити відсутність secrets і великих generated fixtures у Git.

Критерій готовності:

- `docker compose up --build` піднімає повний стек;
- чистий clone проходить documented setup;
- CI дає докази всіх ключових інваріантів;
- проєкт відповідає Definition of Done Sift.

## 6. Рекомендований найближчий порядок роботи

Найближчі реалізаційні кроки:

1. реалізувати production Docker images і повний compose stack етапу 12;
2. додати GitHub Actions для clean migrations, integration/E2E, audit та окремого memory stress;
3. завершити deployment hardening, документацію і фінальне Definition of Done review.

Такий порядок дає вертикальний результат на кожному кроці та не створює worker-логіку без готових persistence/storage boundaries.
