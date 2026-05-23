# Server Status

Date: 2026-05-24

## Current state

Phase 1, the server-side Phase 2 storage slice, Phase 3 in
full (provider proxy, stream-job WebSocket, hub passthrough,
client URL switchover, legacy NodeStorage / crypto surface, and
Express deletion), and Phase 6 completion-route slices through
the 6-28 closeout all exist on the `fastify` branch. Phase 7 has
landed 43 slices through 7-11h: the chat-route scaffold + the wired
`/api/v1/generate/chat` route, the `/api/v1/generate/preview-prompt`
JSON shortcut, parser/static/plain leaves, history shaping through
added-token preflight + start-trigger handoff, regex scripts, module
helpers, lorebook activation through budget-aware truncation, the
tokens / budget chain, the Phase 7-safe trigger runner through the
`runStartTrigger` handoff, the complete template renderer, and the
closed critical-path assembler (`assemblePrompt`, 7-11a–f):

- `server/fastify/src/index.ts` boots the app on
  `RISU_API_HOST` / `RISU_API_PORT` (defaults `0.0.0.0:6002`).
- `server/fastify/src/app.ts` builds Fastify, registers
  `@fastify/rate-limit`, registers a raw-body parser for supported
  asset content types, registers `@fastify/websocket`, opens the
  SQLite metadata DB, registers the health/auth/bootstrap/import/
  assets/backups/proxy/stream-job/hub/legacy-storage/generation
  routes, registers the Phase 7 chat + preview-prompt routes, boots
  the prompt-variable parser backend, and serves `RISU_API_STATIC_ROOT`
  via `@fastify/static` when that directory exists.
- `server/fastify/src/config.ts` reads `RISU_API_HOST`,
  `RISU_API_PORT`, `RISU_API_DATA_DIR`, `RISU_API_BODY_LIMIT`,
  `RISU_API_STATIC_ROOT`, `TRUST_PROXY`, and `RISU_HUB_URL`
  (default `https://sv.risuai.xyz`).
- `server/fastify/src/db.ts` creates `data/risu.db` with
  `schema_version(id, version, revision)`, WAL mode, and foreign
  keys.
- `server/fastify/src/auth.ts` stores the first-run password and
  known public-key hashes under the Fastify data dir, then verifies
  client-signed ES256 assertions from `risu-auth`.
- `server/fastify/src/repository.ts` owns `data/db.json`,
  `data/assets/<sha256>.<ext>`, and `data/backups/<id>/`.
  Domain data is still a JSON blob; SQLite still holds system
  metadata only.
- Routes currently implemented: `GET /api/v1/health`,
  `GET /api/v1/auth/status`, `POST /api/v1/auth/setup`,
  `POST /api/v1/auth/login`, `POST /api/v1/auth/crypto`,
  `GET /api/v1/bootstrap`, `POST /api/v1/import/risusave`,
  `POST /api/v1/assets`, `GET/HEAD /api/v1/assets/:id`,
  `POST /api/v1/assets/exists`, `GET /api/v1/backups`,
  `POST /api/v1/backups`, `POST /api/v1/backups/:id/restore`,
  `DELETE /api/v1/backups/:id`, `POST /api/v1/proxy/fetch`,
  `POST /api/v1/proxy/stream-jobs`,
  `DELETE /api/v1/proxy/stream-jobs/:id`, the WebSocket upgrade
  at `GET /api/v1/proxy/stream-jobs/:id/ws`,
  `ANY /api/v1/hub/*`, `GET /api/v1/storage/list`,
  `GET /api/v1/storage/read`, `POST /api/v1/storage/write`,
  `POST /api/v1/storage/remove`, `POST /api/v1/generate/completion`,
  `POST /api/v1/generate/chat`, and
  `POST /api/v1/generate/preview-prompt`.
- `server/fastify/__tests__/` covers the implemented routes, static
  serving, provider dispatchers, and Phase 7 prompt helpers through
  `pnpm api:test`. Current Phase 7 helper tests include
  `promptVariables`, `staticSections`, `plainSections`, `history`,
  `scripts`, `modules`, `lorebook`, `tokens`, `preflight`,
  `budgetFinalize`, `triggers`, `templates`, `memory`, and `assemble`,
  plus the `generation.chat` route tests covering `/chat` (SSE) and
  `/preview-prompt` (JSON).
- `server/fastify/src/proxy.ts` and `server/fastify/src/routes/proxy.ts`
  hold the Phase 3A generic-proxy surface. The route is scoped to
  its own plugin instance with a catch-all content-type parser so
  request bodies are forwarded as raw bytes regardless of
  content-type. Auth uses the standard `requireAuth` (ES256 only,
  consistent with every other Fastify route).
- `server/fastify/src/streamJobs.ts` owns the Phase 3B stream-job
  lifecycle (`JobRegistry`, `sanitizeLocalTargetUrl`,
  `runStreamJob`) and `server/fastify/src/routes/streamJobs.ts`
  registers the POST / DELETE / WebSocket routes. The WS upgrade
  is the only authenticated route that accepts the ES256
  assertion via a `risu-auth` query-string parameter in addition
  to the header (EventSource-style clients can't set custom
  headers); see [`../phases/phase-3-proxy.md`](../phases/phase-3-proxy.md).
  `buildApp` schedules `JobRegistry.tickGc` on a 60s unref'd
  interval and clears it via `onClose`.
- `server/fastify/src/routes/hub.ts` registers the Phase 3C hub
  passthrough at `ANY /api/v1/hub/*`. The route strips the
  `/api/v1/hub` prefix and forwards the suffix to
  `config.hubUrl` (`RISU_HUB_URL` env, default
  `https://sv.risuai.xyz`); `x-risu-node-path` overrides the
  destination URL entirely. It uses the same catch-all
  content-type parser pattern as the proxy fetch route, strips
  `content-encoding` / `content-length` / `transfer-encoding`
  from upstream responses, and follows exactly one 3xx redirect
  manually.
- Phase 3D-Narrow added the static-serving index.html injection
  that gives the SPA `globalThis.__FASTIFY__ = true`. Phase
  3D-Broad extends it to inject `globalThis.__NODE__ = true` as
  well, so every existing self-host gate in the SPA
  (NodeStorage, save flow, prefer-remote saves) activates under
  Fastify too. Client-side, `platform.isFastifyServer` and the
  long-standing `isNodeServer` both become true; URL builders
  in `globalApi.svelte.ts` and `characterCards.ts` prefer
  `/api/v1/*`; and `isWeb` correctly excludes Fastify deployments.
- `server/fastify/src/routes/legacyStorage.ts` adds the
  key-value storage surface the SPA's `NodeStorage` /
  `AutoStorage` / cold-storage paths target:
  `/api/v1/storage/{list,read,write,remove}` with the same
  hex-key + raw-bytes shape as the legacy Express
  `/api/{list,read,write,remove}` routes. Files live under
  `${dataDir}/save/`. `POST /api/v1/auth/crypto` is the
  matching sha256 hex shim for the password digest. Client-side,
  `src/ts/storage/nodeStorage.ts` picks its endpoint set at
  module-load time based on `isFastifyServer` and normalizes
  the auth-status response shape (`{noPassword, authorized}` on
  Fastify, `{status}` on Express) into the existing
  unset / incorrect / success enum.
- `server/fastify/src/routes/generation.ts` adds the Phase 6
  completion route. It validates the provider, model, messages,
  stream flag, and options body; requires auth; streams through the
  normalized `event: chunk` / `event: done` envelope when the
  selected provider supports streaming; and dispatches through the
  provider files in `server/fastify/src/generation/`. The route
  supports `echo`, `openai`, `nanogpt`, `openrouter`,
  `anthropic`, `mistral`, `cohere`, `gemini`,
  `openai-legacy-instruct`, `openai-responses`, `kobold`,
  `ooba-legacy`, `ollama`, `bedrock`, and `horde`. The client
  adapter routes supported variants including Ollama Cloud,
  Vertex AI Gemini, AWS Bedrock Claude, Stable Horde text, and
  `reverse_proxy` / `xcustom:::` for OpenAI-compatible,
  Anthropic, Mistral, Cohere, OpenAI Responses, and OpenAI legacy
  instruct formats. Unsupported provider strings return
  `{ reason: 'provider not implemented yet: <name>' }` with 501.
  Cohere, legacy instruct, Responses, Kobold, ooba legacy,
  Bedrock, and Horde are currently buffered-only and reject
  `stream: true` with a 400.
- `server/fastify/src/routes/generationChat.ts` registers the two
  Phase 7 generation routes. `POST /api/v1/generate/chat` (7-11g)
  validates `chatId`, `characterId`, mode, and mode-specific fields
  (pre-stream 400), binds `AssembleDeps.loadDatabase` to
  `loadPersisted(dataDir).database`, then calls `assemblePrompt` and
  streams `stage: validate` start/end, `stage: prompt` start, the
  assembled `prompt` event, `stage: prompt` end, and `done`; a
  `stopSending` result or any thrown error (bad IDs, missing database)
  becomes a terminal SSE `error` + `done`. `POST
/api/v1/generate/preview-prompt` (7-11h) is the one-shot JSON variant
  (`validatePreview` + forced `preview_prompt` mode): it returns the
  `result.prompt` payload, `{ stopSending, abortReason }`, or a real
  HTTP 404 (`EntityNotFoundError`) for bad IDs / missing database. Both
  are read-only — `varChanged` persistence + provider dispatch land with
  Phase 7-12.
- `server/fastify/src/prompt/variables.ts`, `staticSections.ts`,
  `plainSections.ts`, `history.ts`, `scripts.ts`, `modules.ts`,
  `lorebook.ts`, `tokens.ts`, `preflight.ts`, `budgetFinalize.ts`,
  `tokenizerConfig.ts`, `triggerVars.ts`, `triggerDataEffects.ts`,
  `triggers.ts`, `templates.ts`, `memory.ts`, and `assemble.ts` are
  real Phase 7 helpers. `assemblePrompt` chains 7-11a–f and returns the
  assembled payload (or `{ stopSending }`).
- Known limitation: `ANY /api/v1/hub/*` keeps `requireAuth`, so
  on password-protected deployments browser-loaded resources
  (`<img src=hubURL/...>`, `<iframe src=hubURL/...>`) will 401
  because they cannot send `risu-auth`. Tracked as a follow-up
  in [`next-steps.md`](next-steps.md).
- Known limitation: direct `POST /api/v1/proxy/fetch` request-close
  abort wiring is not separately implemented. The route supports
  `risu-timeout-ms`; stream jobs abort through explicit delete,
  timeout, and GC.

Other runtime servers still in tree:

- `server/hono/` - small Hono scaffold with CSRF middleware,
  `Hello Hono!`, and Node / Bun / Cloudflare static-serving
  entry points. It is not on the Fastify migration path.

Root `package.json` has `pnpm hono:build` for the Hono static
bundle and `pnpm api:dev` / `pnpm api:start` / `pnpm api:test`
for the Fastify server. The Dockerfile is configured to run
`pnpm api:start`, expose 6002, and persist `/app/data`;
`docker-compose.yml` maps `6002:6002`. The runtime stage installs
production dependencies only; `tsx` and `@fastify/websocket` are now
under `dependencies` after `1eddbfba`, so `pnpm api:start` resolves
in the current image layout. The Express `pnpm runserver` script has
been removed; `server/node/` no longer exists.

## What lands when

- **Phase 1.** Done 2026-05-20. `server/fastify/` directory,
  `pnpm api:dev` / `pnpm api:start` / `pnpm api:test`, health
  endpoint, env loader, auth scaffold, DB connection, and Vite
  proxy `/api` -> Fastify.
- **Phase 2.** Done 2026-05-20. `data/db.json` blob for domain
  state, repository read/write, raw asset storage, JSON save
  import, backups, Fastify static serving, and container
  switchover. Domain SQL tables are deferred to later server phases,
  per resource. Binary `.risu` codec and bundle export stay client-side
  until Phase 9. See
  [`../phases/phase-2-storage.md`](../phases/phase-2-storage.md).
- **Phase 3.** Closed 2026-05-21. Fastify owns provider proxy
  fetch, hub passthrough, stream-job HTTP+WS, the legacy
  key-value storage, auth, crypto, and the SPA static surface
  (with `__NODE__` + `__FASTIFY__` injection so the SPA picks
  up the self-host gates). `server/node/`, the `runserver`
  script, and the express / express-rate-limit /
  node-html-parser dependencies have been removed.
- **Phase 6.** Completion routing closed on 2026-05-22 in Phase
  6-28. Landed: `POST /api/v1/generate/completion`, the normalized
  SSE envelope, echo, OpenAI Chat Completions, NanoGPT chat,
  OpenRouter, Anthropic Messages / legacy / NanoGPT Messages,
  Mistral, Cohere, Gemini, DeepSeek / DeepInfra via the
  OpenAI-compatible key path, OpenAI legacy instruct / NanoGPT
  legacy, OpenAI Responses / NanoGPT Responses, Ollama Cloud
  variants, Kobold, ooba legacy, native Ollama, Vertex AI Gemini,
  AWS Bedrock Claude, Stable Horde text, and `xcustom:::` /
  `reverse_proxy` overlays for OpenAI-compatible, Anthropic,
  Mistral, Cohere, OpenAI Responses, and OpenAI legacy instruct
  formats. Translation, TTS, image, token-counting, and trigger
  execution helper routes remain follow-up slices. NovelAI,
  NovelList, and ooba OAI-compatible are deferred to Phase 7
  because they need server-owned character / user state for prompt
  flattening.
- **Phase 7.** Server-side prompt assembly + lorebook activation.
  In progress. Forty-three slices have landed through 7-11h:
  `/api/v1/generate/chat` scaffold + the wired route, nine-event prompt
  SSE taxonomy, server-side variable expansion, static/plain prompt
  sections, history shaping through multimodal inlays + token preflight +
  start-trigger handoff, regex scripts, module helpers, lorebook
  constant / keyword / recursive / depth / budget truncation helpers,
  the tokens / budget chain, the trigger runner through the
  `runStartTrigger` handoff, the complete template renderer, the closed
  critical-path assembler (7-11a–f), the wired `/api/v1/generate/chat`
  route (7-11g), and the `/api/v1/generate/preview-prompt` JSON shortcut
  (7-11h). Next slice is 7-11i, the `/chat` SSE `info` telemetry event.
- **Phase 8.** Hypa V3 chunking + embeddings + summary jobs.

## Reference: what move-to-fastify shipped

For each phase, the `move-to-fastify` branch already has a worked
example. The links below are commit prefixes; resolve them on that
branch.

- Phase 1 foundation: `0c3de7de`, `d430d31c`, `e10499a2`.
- Phase 2 storage: `ae2252e5`, `f04c3e04`, `a1836719`,
  `2d786cb6`, `ba5e1c82`, `3d3e217e`, `511eecec`,
  `19faacac`, `7cfed755`, `2399e885`, `55f421d4`,
  `b6a50d3e`.
- Phase 3 proxy: `a1711803`, `fcfd69a8`, `58cfea1a`,
  `c929ca87`.
- Command-resource slice on `move-to-fastify` (that branch's phase
  labels differ from this roadmap): `28f6647d` and following, through
  `15b8ed7d` / `54cfe6d5`.
- Phase 5 generation: `648fe0fb` (OpenAI), `a1c6360a`
  (Anthropic), `8ddeb9d0` (Gemini), `92034749`
  (OpenRouter / NanoGPT / Mistral / Cohere / HF / DeepInfra),
  `fe8179bd` (local providers), `5034ff42` (Vertex), and
  the matching translate / TTS / image commits.
- Phase 6 store wiring: `2d99e885`, `fb062b10`,
  `bb5f5201`, `1a161664`.

This roadmap is not bound to those commits. They are useful when
you need to see "how did someone do this in TypeScript" but the
final API shape on `fastify` is set by [`architecture.md`](../architecture.md),
not by their endpoint URLs.

## Notes

- Node 24+ is required for `node:sqlite`. `package.json#engines`
  is currently `>=24.0.0`.
- Fastify serves the SPA when `RISU_API_STATIC_ROOT` points at a
  built `dist/`; unknown non-API GETs fall back to `index.html`.
