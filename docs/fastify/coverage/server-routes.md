# Server Route Tests

Date: 2026-05-25

Status: Phase 1, Phase 2, Phase 3, the closed Phase 6
completion-route tests, Phase 7 `/chat` / `/preview-prompt`, and landed
Phase 8 memory slices have coverage under `server/fastify/__tests__/`.
Unlanded helper routes, remaining Phase 8 routes, and Phase 9 commands
remain target test rows.

## Phase 1: Foundation

| Route                          | Pinned behavior                                | Status      |
| ------------------------------ | ---------------------------------------------- | ----------- |
| `GET /api/v1/health`           | Returns `{ status: 'ok', revision, schemaVersion }`. | covered by `server/fastify/__tests__/smoke.test.ts` |
| `GET /api/v1/auth/status`      | Reports `noPassword` before setup; accepts valid assertions and rejects expired ones. | covered by `server/fastify/__tests__/smoke.test.ts` |
| `POST /api/v1/auth/setup`      | First call sets password; second rejects.      | covered by `server/fastify/__tests__/smoke.test.ts` |
| `POST /api/v1/auth/login`      | Registers a public key after password match; matching ES256 assertions authorize later status checks. | covered by `server/fastify/__tests__/smoke.test.ts` |

## Phase 2: Storage, Import, Assets, Backups

| Route                                       | Pinned behavior                            | Status      |
| ------------------------------------------- | ------------------------------------------ | ----------- |
| `GET /api/v1/bootstrap`                     | Fresh data dir returns `revision: 0`, current `schemaVersion`, `database: null`, and `assetBaseUrl`. Requires auth once a password is set. | covered by `server/fastify/__tests__/bootstrap.test.ts` |
| `POST /api/v1/import/risusave`              | JSON `{ database }` replaces `db.json.database`, bumps revision, rejects missing database, returns zeroed `assetReport`. | covered by `server/fastify/__tests__/bootstrap.test.ts` |
| `POST /api/v1/assets`                       | Auth-gated raw upload computes SHA-256, writes `data/assets/<sha>.<ext>`, returns metadata + revision, and is idempotent on re-upload. | covered by `server/fastify/__tests__/assets.test.ts` |
| `GET /api/v1/assets/:id`                    | Public read serves stored bytes with Content-Type, immutable cache header, and 404 for unknown / malformed ids. | covered by `server/fastify/__tests__/assets.test.ts` |
| `HEAD /api/v1/assets/:id`                   | Mirrors GET headers with no body.          | covered by `server/fastify/__tests__/assets.test.ts` |
| `POST /api/v1/assets/exists`                | Public preflight returns missing SHA-256 ids and validates `ids: string[]`. | covered by `server/fastify/__tests__/assets.test.ts` |
| `GET /api/v1/backups`                       | Auth-gated list returns backups newest-first or an empty array. | covered by `server/fastify/__tests__/backups.test.ts` |
| `POST /api/v1/backups`                      | Auth-gated create snapshots `db.json`, writes manifest + snapshot, accepts optional string label, does not bump revision. | covered by `server/fastify/__tests__/backups.test.ts` |
| `POST /api/v1/backups/:id/restore`          | Auth-gated restore copies snapshot to live `db.json`, bumps revision, rejects unknown / malformed ids. | covered by `server/fastify/__tests__/backups.test.ts` |
| `DELETE /api/v1/backups/:id`                | Auth-gated delete removes backup directory and rejects unknown / malformed ids. | covered by `server/fastify/__tests__/backups.test.ts` |

Static serving is covered by `server/fastify/__tests__/static.test.ts`:
Fastify serves `index.html`, nested static assets, SPA fallback for
unknown non-API GETs, no fallback for `/api/*` or non-GET routes,
and clean API behavior when `staticRoot` is absent.

No Phase 2 server routes exist for `.risu` export, bundle export,
asset delete, or asset GC. `.risu` encode/decode and bundle assembly
stay client-side until Phase 9.

## Phase 3: Proxy + Hub

| Route                                          | Pinned behavior                          | Status      |
| ---------------------------------------------- | ---------------------------------------- | ----------- |
| `POST /api/v1/proxy/fetch`                     | Auth-gated POST proxy forwards upstream status/body, raw body bytes, filtered response headers, sanitized request headers, and `risu-header` overrides. | covered by `server/fastify/__tests__/proxy.test.ts` |
| `POST /api/v1/proxy/fetch` (SSE)               | Streams a multi-chunk `text/event-stream` upstream body through without route-level buffering. | covered by `server/fastify/__tests__/proxy.test.ts` |
| `POST /api/v1/proxy/fetch` (timeout)           | Honors `risu-timeout-ms` and returns 504 on timeout. | covered by `server/fastify/__tests__/proxy.test.ts` |
| `POST /api/v1/proxy/fetch` (client disconnect) | Direct request-close abort wiring is not separately implemented; hung upstreams are bounded by `risu-timeout-ms`. | known gap |
| `POST /api/v1/proxy/stream-jobs`               | Auth-gated create returns `jobId` + normalized `heartbeatSec`; rejects non-local targets, disallowed methods, and oversized `bodyBase64`. | covered by `server/fastify/__tests__/streamJobsRoutes.test.ts` |
| `GET /api/v1/proxy/stream-jobs/:id/ws`         | Sends `job_accepted`, flushed pending events, `upstream_headers`, `chunk`, `done`, and accepts `risu-auth` via header or query string. | covered by `server/fastify/__tests__/streamJobsRoutes.test.ts` |
| `DELETE /api/v1/proxy/stream-jobs/:id`         | Cancels an existing in-flight job and returns success for unknown ids. | covered by `server/fastify/__tests__/streamJobsRoutes.test.ts` |
| Stream-job lifecycle helpers                   | URL sanitization, private/local host detection, timeout/heartbeat normalization, pending-event caps, GC, delete abort, and mid-stream abort events. | covered by `server/fastify/__tests__/streamJobs.test.ts` |
| `ANY /api/v1/hub/*`                            | Auth-gated hub passthrough forwards path/query and body to `RISU_HUB_URL`, strips hop-by-hop/auth headers, rewrites origin, strips unsafe response headers, follows one redirect, and returns 502 on upstream failure. | covered by `server/fastify/__tests__/hub.test.ts` |
| `ANY /api/v1/hub/*` (x-risu-node-path)         | Honors the override header as a complete upstream URL. | covered by `server/fastify/__tests__/hub.test.ts` |
| `GET /api/v1/storage/list`                     | Auth-gated list returns utf-8 decoded keys from hex filenames. | covered by `server/fastify/__tests__/legacyStorage.test.ts` |
| `GET /api/v1/storage/read`                     | Auth-gated read validates hex path, streams raw bytes, and returns an empty octet-stream body for missing keys. | covered by `server/fastify/__tests__/legacyStorage.test.ts` |
| `POST /api/v1/storage/write`                   | Auth-gated raw write validates hex path, rejects empty bodies, and writes bytes under `${dataDir}/save`. | covered by `server/fastify/__tests__/legacyStorage.test.ts` |
| `POST /api/v1/storage/remove`                  | Auth-gated remove deletes one or many `$$`-joined hex keys and is idempotent for missing keys. | covered by `server/fastify/__tests__/legacyStorage.test.ts` |
| `POST /api/v1/auth/crypto`                     | Returns sha256 hex for string `data` and rejects non-string payloads. | covered by `server/fastify/__tests__/legacyStorage.test.ts` |

## Phase 6: Generation Helpers

| Route                                      | Pinned behavior                            | Status      |
| ------------------------------------------ | ------------------------------------------ | ----------- |
| `POST /api/v1/generate/completion`         | Auth, request validation, `501` for unsupported providers, normalized SSE envelope, and buffered/streaming dispatch for the closed Phase 6 provider matrix. Stable Horde text is provider `horde` on this route; no separate Horde route exists. | covered by `server/fastify/__tests__/generation.completion.test.ts`, `echo.test.ts`, `openai.test.ts`, `additionalParams.test.ts`, `anthropic.test.ts`, `mistral.test.ts`, `cohere.test.ts`, `gemini.test.ts`, `vertexAuth.test.ts`, `openaiLegacyInstruct.test.ts`, `openaiResponses.test.ts`, `kobold.test.ts`, `oobaLegacy.test.ts`, `ollama.test.ts`, `bedrock.test.ts`, `sigv4.test.ts`, `horde.test.ts`, and `src/ts/process/request/tests/serverCompletion.test.ts` |
| `POST /api/v1/generate/translate`          | DeepL / DeepLX / Google.                   | not started |
| `POST /api/v1/generate/tts`                | OpenAI / ElevenLabs / NovelAI / Hugging Face API Inference. | not started |
| `POST /api/v1/generate/image`              | Provider routing + body shaping for current `sdProvider` values. | not started |
| `POST /api/v1/generate/count-tokens`       | Returns token count per encoder.           | not started |
| `GET /api/v1/generate/encodings`           | Lists tokenizers.                          | not started |
| `POST /api/v1/generate/triggers/run`       | Worker sandbox returns trigger result.     | not started |

Per-provider request / response coverage lives in
[`providers.md`](providers.md).

## Phase 7: Chat / Prompt Assembly

| Route                                       | Pinned behavior                           | Status      |
| ------------------------------------------- | ----------------------------------------- | ----------- |
| `POST /api/v1/generate/chat` (validation)   | Auth, body validation for modes/ids/options (pre-stream 400), `text/event-stream` response. | covered by `server/fastify/__tests__/generation.chat.test.ts` |
| `POST /api/v1/generate/chat` (assembly)     | Calls `assemblePrompt`; streams `stage(validate)` -> `stage(prompt,start)` -> `prompt` -> `message_patch` -> `stage(prompt,end)` -> `info` -> `done`; `stopSending`/bad-ID/missing-DB -> terminal SSE `error` + `done` with no `info`; builds and emits the 7-12d mutation payload. | covered (7-11g/i, 7-12d-i/ii) by `generation.chat.test.ts` and `assemble.test.ts` |
| `POST /api/v1/generate/chat` (`varChanged`) | Persists chat variable writes for `send` / `continue` / `regenerate` requests while keeping preview modes read-only. | covered (7-12d-i) by `generation.chat.test.ts` |
| `POST /api/v1/generate/chat` (transport)    | Internal provider chunk transport maps `CompletionStreamFrame` sources to chat `token`, `error`, and enriched `done` after `prompt` / `message_patch` / `info`. | covered (7-12d-iii-a/b) by `providerTransport.test.ts` and `generation.chat.test.ts` |
| `POST /api/v1/generate/chat` (dispatch)     | Real provider dispatch behind `db.useServerPromptAssembly`, browser send orchestration, `generationId`, `generationInfo`, enriched `done`, and `addRerolls` accumulation. | covered (7-12d-iii-b) by `generation.chat.test.ts`, `src/ts/process/request/tests/serverChat.test.ts`, `sendChat.serverPreview.test.ts`, and `sendChat.fixtures.serverBacked.test.ts` |
| `POST /api/v1/generate/chat` (side effects / restoration) | Typed `tts` `side_effect` and `error.restoration` rollback after browser-visible mutations begin. | covered (7-12d-iv) by `generation.chat.test.ts`, `src/ts/process/request/tests/serverChat.test.ts`, `serverMessagePatch.test.ts`, and `sendChat.fixtures.serverBacked.test.ts` |
| `POST /api/v1/generate/chat` (continue)     | Resumes assistant row.                    | assembled and server-dispatched through the common send-like path |
| `POST /api/v1/generate/chat` (regenerate)   | Truncates + rerolls.                      | assembled and server-dispatched through the common send-like path |
| `POST /api/v1/generate/preview-prompt`      | One-shot JSON assembled prompt; `result.prompt` on success, `{ stopSending }` on abort, HTTP 404 for bad IDs / missing DB. | covered (7-11h) by `generation.chat.test.ts` |

Plus: prompt snapshot tests - given a canned DB + preset + chat
state, the assembled `messages[]` matches a recorded snapshot.
Prompt leaf tests already exist for `variables.ts`,
`staticSections.ts`, `plainSections.ts`, `history.ts`,
`scripts.ts`, `modules.ts`, `lorebook.ts`, `tokens.ts`,
`preflight.ts`, `budgetFinalize.ts`, `triggers.ts`,
`templates.ts`, `memory.ts`, and `assemble.ts` (the full
7-11a–f chain); a recorded `messages[]` snapshot suite can layer
on now that `assemblePrompt` is real.

## Phase 8: Memory

| Route                                       | Pinned behavior                           | Status      |
| ------------------------------------------- | ----------------------------------------- | ----------- |
| `GET /api/v1/memory/chunks/:chatId`         | Auth-gated list by chat, repository ordering, empty results, and current row shape. | covered by `server/fastify/__tests__/memoryReadRoutes.test.ts` |
| `GET /api/v1/memory/summaries/:chatId`      | Auth-gated list by chat, optional model filter, empty results, and current row shape. | covered by `server/fastify/__tests__/memoryReadRoutes.test.ts` |
| `POST /api/v1/memory/jobs`                  | Auth-gated enqueue for `chunk`, `embed`, and `summarize`; emits `memory.job`. | covered by `server/fastify/__tests__/memoryJobsRoutes.test.ts` |
| `GET /api/v1/memory/jobs`                   | Lists active jobs with chat/kind/status filters and validation. | covered by `server/fastify/__tests__/memoryJobsRoutes.test.ts` |
| `DELETE /api/v1/memory/jobs/:id`            | Cancels pending/running jobs, is idempotent for terminal states, and emits progress. | covered by `server/fastify/__tests__/memoryJobsRoutes.test.ts` |

Plus: repository primitives, job lifecycle (`pending -> running ->
completed`), retry/backoff, boot recovery, progress events, memory
planning, summary prompt building, summary adapter, and the 8-4c
summarize job handler are covered by the focused memory tests under
`server/fastify/__tests__/memory*.test.ts`.

## Phase 9: Commands

| Resource family   | Endpoints                                            | Status      |
| ----------------- | ---------------------------------------------------- | ----------- |
| character         | create / patch / delete / reorder + child replaces    | not started |
| chat              | create / patch / delete / reorder                     | not started |
| message           | append / edit / delete / reroll-placeholder          | not started |
| preset            | create / patch / delete / per-row prompt-item        | not started |
| persona / loadout | create / patch / delete                              | not started |
| plugin / module   | create / patch / delete                              | not started |
| settings          | patch per group                                       | not started |
| plugin-storage    | patch kv                                              | not started |

Plus: revision conflict (409 + currentRevision), SSE event per
command.
