# Architecture

Date: 2026-05-22

This doc describes the target shape of the Fastify server and the
boundaries between it and the browser client. Phase 1, Phase 2,
Phase 3, and Phase 6 completion-route files through closeout slice
6-28 already exist; modules marked by later phases are target
layout, not current implementation.

## Server module layout

```
server/fastify/
  src/
    index.ts            entry point; reads env, builds app, listens
    app.ts              Fastify app factory; plugins, resources, routes
    config.ts           env loading and validation
    db.ts               node:sqlite handle, WAL pragma, schema metadata
    auth.ts             password + signed-assertion auth
    http.ts             shared auth/header helpers
    repository.ts       db.json, assets, backups now; SQL domain repo later
    proxy.ts            generic proxy helpers
    streamJobs.ts       proxy stream-job registry + local URL guard
    routes/
      health.ts
      auth.ts
      bootstrap.ts
      save.ts
      assets.ts
      backups.ts
      proxy.ts
      streamJobs.ts
      hub.ts
      legacyStorage.ts
      generation.ts       POST /api/v1/generate/completion
    generation/
      frames.ts           shared completion result/frame types
      additionalParams.ts body/header overlay helper
      echo.ts             deterministic developer provider
      openai.ts           OpenAI-compatible chat completions
      anthropic.ts        Anthropic Messages-compatible dispatch
      bedrock.ts          AWS Bedrock Claude dispatch
      cohere.ts
      gemini.ts
      horde.ts
      kobold.ts
      mistral.ts
      ollama.ts
      oobaLegacy.ts
      openaiLegacyInstruct.ts
      openaiResponses.ts
      sigv4.ts            Bedrock signing helper
      vertexAuth.ts       Vertex AI service-account JWT exchange
    events.ts           SSE event bus (planned Phase 9)
    tokenizer.ts        tiktoken + web-tokenizers encoders (planned Phase 6)
    generate/
      router.ts         POST /api/v1/generate/* routes
      providers/        one file per provider family
      streaming.ts      SSE forwarder + abort propagation
    prompt/
      assemble.ts       prompt template walker
      lorebook.ts       activation, recursion, budget
      tokens.ts         budget accounting
    memory/
      hypav3.ts         server-side Hypa V3 adapter
      jobs.ts           async embedding + summary queue
    media/
      translate.ts      DeepL, DeepLX, Google
      tts.ts            OpenAI, ElevenLabs, NovelAI
      image.ts          DALL-E, Stability, etc.
    plugins/
      mcp.ts            MCP trust gate (no execution yet)
    util/
      http.ts           shared fetch helpers
      errors.ts         typed errors with HTTP mapping
```

Keep the router files thin: they validate input and call into the
matching module. Persistence and business logic live in the modules,
not the route handlers.

## API surface

Routes are versioned at `/api/v1/`. Verb choice follows REST: `POST`
creates or invokes, `PATCH` partial updates, `PUT` replaces a child
collection, `DELETE` removes, `GET` reads. Revision-tracked
domain-state mutations return the new server revision; backup
create/delete, auth setup/login, and the Phase 3 legacy storage
compatibility routes are administrative or bridge operations and do
not bump revision. Every future event includes the revision it
represents.

Implemented now:

- `GET /api/v1/health`
- `GET /api/v1/auth/status`, `POST /api/v1/auth/setup`,
  `POST /api/v1/auth/login`, `POST /api/v1/auth/crypto`
- `GET /api/v1/bootstrap` - full database snapshot
- `POST /api/v1/import/risusave` - JSON `{ database }` import
- `POST /api/v1/assets`, `GET /api/v1/assets/:id`,
  `HEAD /api/v1/assets/:id`, `POST /api/v1/assets/exists`
- `GET /api/v1/backups`, `POST /api/v1/backups`,
  `POST /api/v1/backups/:id/restore`, `DELETE /api/v1/backups/:id`
- `POST /api/v1/proxy/fetch`
- `POST /api/v1/proxy/stream-jobs`,
  `GET /api/v1/proxy/stream-jobs/:id/ws`,
  `DELETE /api/v1/proxy/stream-jobs/:id`
- `ANY /api/v1/hub/*` - passthrough to `RISU_HUB_URL`
- `GET /api/v1/storage/list`, `GET /api/v1/storage/read`,
  `POST /api/v1/storage/write`, `POST /api/v1/storage/remove`
- `POST /api/v1/generate/completion` - auth-gated provider
  dispatch. Current provider strings are `echo`, `openai`,
  `nanogpt`, `openrouter`, `anthropic`, `mistral`, `cohere`,
  `gemini`, `openai-legacy-instruct`, `openai-responses`,
  `kobold`, `ooba-legacy`, `ollama`, `bedrock`, and `horde`.
  The client adapter also routes covered variants such as
  DeepSeek / DeepInfra keyIdentifier models, Ollama Cloud,
  `reverse_proxy` / `xcustom:::` for OpenAI-compatible,
  Anthropic, Mistral, Cohere, OpenAI Responses, and OpenAI legacy
  instruct formats, plus Vertex AI Gemini, AWS Bedrock Claude, and
  Stable Horde text. Unsupported provider strings return `501`.
- Optional static serving from `RISU_API_STATIC_ROOT`, including
  `GET /` and non-API GET SPA fallback.

Planned later (final shape is locked phase by phase, not by this
list):

- `GET /api/v1/events` - SSE stream of committed mutations
- `POST /api/v1/commands/<resource>[/...]` - one endpoint per
  resource family (character, chat, message, preset, persona, plugin,
  module, ...). No whole-state PUT.
- `POST /api/v1/generate/translate`, `tts`, and `image`. Stable
  Horde text currently lands as provider `horde` on
  `/api/v1/generate/completion`, so no separate Horde route exists
  in the current tree.
- `POST /api/v1/generate/count-tokens`,
  `GET /api/v1/generate/encodings`.
- `GET /api/v1/export/risusave`, `GET /api/v1/export/bundle`, and
  multipart `.risu` import in Phase 9, after the server owns the
  final per-resource schema. No Phase 2 server export route exists.

Conscious differences vs the `move-to-fastify` branch:

- **No `PUT /api/v1/state/components`.** Bootstrap reads + per-resource
  command writes only. The whole-state save was a bridge; we are
  starting without it.
- **No `completion-with-assembly` indirection.** Once Phase 7 lands,
  `/api/v1/generate/completion` is what server-side prompt assembly
  hits internally; the browser hits a higher-level
  `/api/v1/generate/chat` that owns assembly + dispatch.
- **No group-chat commands.** Group chat is removed in Phase 0; no
  endpoint exists for membership patches.

## Persistence

- SQLite via `node:sqlite`, WAL mode, foreign keys on. One file at
  `data/risu.db`, no multi-tenant split. The Phase 1 schema lives
  here: `schema_version(id, version, revision)`. Auth currently
  lives in data-dir files, not in SQLite. **System state only.**
- Domain state lives in a single JSON blob at `data/db.json` during
  the migration window. Phase 2 ships this blob plus bootstrap,
  JSON import, assets, and backups against it. The blob carries a
  top-level `_version` integer for shape evolution. See
  [`phases/phase-2-storage.md`](phases/phase-2-storage.md) for the
  rationale.
- Per-resource SQL tables land in later server phases, when an
  extracted API defines the shape that resource actually needs.
  Each extraction runs a one-time boot migration that moves the field out of
  `db.json`. When `db.json` is empty, it is deleted.
- Assets are stored on disk as `data/assets/<sha256>.<ext>`. Asset
  metadata (size, contentType) lives in `db.json.assets` during
  Phase 2 and moves into SQL when the asset API graduates.
- Backups are stored under `data/backups/<id>/` as a `db.json`
  snapshot plus a `manifest.json` listing the revision and uploaded
  asset count.

## Auth

Single-user. Password set on first run; subsequent calls present a
short-lived ES256 client-signed assertion. The browser keeps a
keypair in localStorage / IndexedDB; the server stores the password
at `data/__password` and SHA-256 hashes of known public keys at
`data/__known_public_key_hashes.json`.

This matches the legacy Express auth shape that existed before
Phase 3 deleted `server/node/`, with Fastify storing its files under
`RISU_API_DATA_DIR` instead of the legacy `save/` directory. We do
not redesign auth in this migration unless a concrete need surfaces.

## Events

Planned for Phase 9; not implemented in the current Fastify tree.
`GET /api/v1/events` will be a Server-Sent Events stream. Every
committed mutation emits one event:
`{ revision, type, resource, ts, detail }`. The client subscribes
once on startup and uses events to invalidate its in-memory
projection.

Heartbeats every 15s keep idle connections alive. Auth is via
`risu-auth` query string (so EventSource works) or header (for
fetch-based subscribers).

## Boundary rules

Server owns:

- Persisted state. The browser never writes to localForage in
  server-backed mode.
- Provider API keys for fully server-owned flows. During the current
  Phase 6 slices, the client adapter still reads the existing DB key
  fields and sends only the selected provider's key in the
  `/generate/completion` options body; bootstrap masking under
  `RISU_MASK_SERVER_KEYS=1` waits until the server owns every
  provider path a deployment needs.
- Outbound HTTP for generation providers covered by the
  server-backed adapter. Uncovered providers continue through the
  local browser dispatch path until their Phase 6 slice lands.
- Prompt assembly, tokenization, lorebook activation, Hypa V3
  memory.

Browser owns:

- Rendering, input, abort forwarding, focus, scroll.
- Local display state (typing indicators, partial-message render).
- Browser-only effects: TTS playback, image preview, inlay assets
  the user just dropped.
- The `sendChat` UI lease so two screens can't dispatch at once.

Out of scope (see `removed-and-out-of-scope.md`): group chat
membership, peer sync, plugin code execution server-side, Drive
sync, Risu Account Sync.

## Reference notes

- `move-to-fastify`'s `server/fastify/` tree is a worked example of
  the module split above. It is denser than we need (e.g. it ships a
  whole-state bridge, multiple compatibility shims, and group-chat
  commands). Use it to read concrete code, not to set the API
  contract.
- `risuai-metatron`'s `chat_generation/` split
  (`generation_validation`, `message_state`, `prompt_builder`,
  `prompt_sections`, `prompt_history`, `prompt_templates`,
  `prompt_budget`, `lorebook`, `tokenizer`, `providers`,
  `generation_lifecycle`, `postprocess`) is the closest existing
  template for Phase 5 + Phase 7's TypeScript shape.
