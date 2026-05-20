# Server Route Tests

Date: 2026-05-20

Status: the Fastify server does not exist yet. The table below is
the target test set per phase.

## Phase 1: Foundation

| Route                          | Pinned behavior                                | Status      |
| ------------------------------ | ---------------------------------------------- | ----------- |
| `GET /api/v1/health`           | Returns `{ status: 'ok', revision, schemaVersion }`. | not started |
| `GET /api/v1/auth/status`      | Reports `unset` / `set` correctly.             | not started |
| `POST /api/v1/auth/setup`      | First call sets password; second rejects.      | not started |
| `POST /api/v1/auth/login`      | Issues an ES256 assertion accepted by /health. | not started |

## Phase 2: Storage, Import, Export, Assets

| Route                                       | Pinned behavior                            | Status      |
| ------------------------------------------- | ------------------------------------------ | ----------- |
| `GET /api/v1/bootstrap`                     | Empty DB returns `revision: 0`.            | not started |
| `POST /api/v1/import/risusave`              | Multipart with assets resolves references. | not started |
| `GET /api/v1/export/risusave`               | Legacy single-blob export.                 | not started |
| `GET /api/v1/export/bundle`                 | ZIP with save + referenced assets + meta.  | not started |
| `POST /api/v1/assets`                       | Stores file at SHA-256 path; returns id.   | not started |
| `GET /api/v1/assets/:id`                    | Serves file with right Content-Type.       | not started |
| `DELETE /api/v1/assets/:id`                 | Soft-deletes the row.                      | not started |
| `GET /api/v1/backups`                       | Lists backup rows.                         | not started |
| `POST /api/v1/backups`                      | Snapshots DB; writes .risu file.           | not started |
| `POST /api/v1/backups/:id/restore`          | Rolls DB back; bumps revision.             | not started |
| `DELETE /api/v1/backups/:id`                | Removes row + file.                        | not started |

Plus: round-trip test (import -> export -> diff), asset
reference tracking (referenced / missing / orphaned counts),
revision bumps on each mutation.

## Phase 3: Proxy + Hub

| Route                                          | Pinned behavior                          | Status      |
| ---------------------------------------------- | ---------------------------------------- | ----------- |
| `POST /api/v1/proxy/fetch`                     | Forwards request; sanitizes headers.     | not started |
| `POST /api/v1/proxy/fetch` (SSE)               | Streams chunks without buffering.        | not started |
| `POST /api/v1/proxy/fetch` (timeout)           | Honors `risu-timeout-ms`.                | not started |
| `POST /api/v1/proxy/fetch` (client abort)      | Aborts upstream when client disconnects. | not started |
| `POST /api/v1/proxy/stream-jobs`               | Returns jobId + heartbeatSec.            | not started |
| `GET /api/v1/proxy/stream-jobs/:id/ws`         | Sends accepted / headers / chunks / done.| not started |
| `DELETE /api/v1/proxy/stream-jobs/:id`         | Cancels in-flight job.                   | not started |
| `ANY /api/v1/hub/*`                            | Passes through to RISU_HUB_URL.          | not started |
| `ANY /api/v1/hub/*` (x-risu-node-path)         | Honors the override header.              | not started |

Plus: URL sanitization (blocked schemes, blocked external hosts
on stream-jobs, IPv6 bracket handling), local-network host
detection.

## Phase 6: Generation Helpers

| Route                                      | Pinned behavior                            | Status      |
| ------------------------------------------ | ------------------------------------------ | ----------- |
| `POST /api/v1/generate/completion`         | OpenAI-shaped; streams SSE; aborts.        | not started |
| `POST /api/v1/generate/horde`              | Stable Horde request shape.                | not started |
| `POST /api/v1/generate/translate`          | DeepL / DeepLX / Google.                   | not started |
| `POST /api/v1/generate/tts`                | OpenAI / ElevenLabs / NovelAI.             | not started |
| `POST /api/v1/generate/image`              | Provider routing + body shaping.           | not started |
| `POST /api/v1/generate/count-tokens`       | Returns token count per encoder.           | not started |
| `GET /api/v1/generate/encodings`           | Lists tokenizers.                          | not started |
| `POST /api/v1/generate/triggers/run`       | Worker sandbox returns trigger result.     | not started |

Per-provider request / response coverage lives in
[`providers.md`](providers.md).

## Phase 7: Chat / Prompt Assembly

| Route                                       | Pinned behavior                           | Status      |
| ------------------------------------------- | ----------------------------------------- | ----------- |
| `POST /api/v1/generate/chat` (send)         | Full pipeline: assemble + dispatch.       | not started |
| `POST /api/v1/generate/chat` (continue)     | Resumes assistant row.                    | not started |
| `POST /api/v1/generate/chat` (regenerate)   | Truncates + rerolls.                      | not started |
| `POST /api/v1/generate/chat` (preview)      | Returns assembled prompt only.            | not started |
| `POST /api/v1/generate/preview-prompt`      | Same shape as preview mode.               | not started |

Plus: prompt snapshot tests - given a canned DB + preset + chat
state, the assembled `messages[]` matches a recorded snapshot.

## Phase 8: Memory

| Route                                       | Pinned behavior                           | Status      |
| ------------------------------------------- | ----------------------------------------- | ----------- |
| `GET /api/v1/memory/chunks/:chatId`         | Lists chunks with statuses.               | not started |
| `GET /api/v1/memory/summaries/:chatId`      | Returns summaries for a model.            | not started |
| `POST /api/v1/memory/jobs`                  | Enqueues a chunk/embed/summarize job.     | not started |
| `GET /api/v1/memory/jobs`                   | Lists pending / running.                  | not started |
| `DELETE /api/v1/memory/jobs/:id`            | Cancels a job.                            | not started |

Plus: job lifecycle (`pending -> running -> completed`), retry
on failure, SSE memory.job events.

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
