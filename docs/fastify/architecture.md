# Architecture

Date: 2026-05-20

This doc describes the intended shape of the Fastify server and the
boundaries between it and the browser client. It is a target, not a
description of code that exists yet.

## Server module layout

```
server/fastify/
  src/
    index.ts            entry point; reads env, builds app, listens
    app.ts              Fastify app factory; route registration only
    config.ts           env loading and validation
    db.ts               node:sqlite handle, WAL pragma, migrations
    auth.ts             password + signed-assertion auth
    repository.ts       SQL <-> domain types; transactions live here
    proxy.ts            outbound provider proxy + stream-jobs
    hub.ts              Risuai hub (sv.risuai.xyz) passthrough
    events.ts           SSE event bus (state change broadcast)
    tokenizer.ts        @dqbd/tiktoken / glm tokenizers
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
collection, `DELETE` removes, `GET` reads. Every mutating route
returns the new server revision; every event includes it.

Greenfield shape (final shape is locked phase by phase, not by this
list):

- `GET /api/v1/health`
- `GET /api/v1/auth/status`, `POST /api/v1/auth/setup`,
  `POST /api/v1/auth/login`
- `GET /api/v1/bootstrap` - full database snapshot
- `GET /api/v1/events` - SSE stream of committed mutations
- `POST /api/v1/import/risusave`, `GET /api/v1/export/risusave`,
  `GET /api/v1/export/bundle`
- `POST /api/v1/assets`, `GET /api/v1/assets/:id`,
  `DELETE /api/v1/assets/:id`
- `GET /api/v1/backups`, `POST /api/v1/backups`,
  `POST /api/v1/backups/:id/restore`, `DELETE /api/v1/backups/:id`
- `POST /api/v1/commands/<resource>[/...]` - one endpoint per
  resource family (character, chat, message, preset, persona, plugin,
  module, ...). No whole-state PUT.
- `POST /api/v1/proxy/fetch`, `POST /api/v1/proxy/stream-jobs`,
  `GET /api/v1/proxy/stream-jobs/:id/ws`,
  `DELETE /api/v1/proxy/stream-jobs/:id`
- `ANY /api/v1/hub/*` - passthrough to `sv.risuai.xyz`.
- `POST /api/v1/generate/completion` - streamed completion.
- `POST /api/v1/generate/translate`, `tts`, `image`, `horde`.
- `POST /api/v1/generate/count-tokens`,
  `GET /api/v1/generate/encodings`.

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

- SQLite via `node:sqlite`, WAL mode, foreign keys on.
- One file at `data/risuai.sqlite`. No multi-tenant split.
- Migrations are numbered SQL files that run on startup; the
  repository asserts schema version before accepting writes.
- Assets are stored on disk as `data/assets/<sha256>.<ext>`. The DB
  only stores metadata + a reference count.
- Backups are stored as `.risu` blobs under `data/backups/<id>.risu`
  with a row in `backups` for metadata.

## Auth

Single-user. Password set on first run; subsequent calls present a
short-lived ES256 client-signed assertion. The browser keeps a
keypair in localStorage / IndexedDB; the server stores the
SHA-256 of the public key on first login.

This matches what `server/node/server.cjs` already does today and is
what `move-to-fastify` ports. We do not redesign auth in this
migration unless a concrete need surfaces.

## Events

`GET /api/v1/events` is a Server-Sent Events stream. Every committed
mutation emits one event: `{ revision, type, resource, ts, detail }`.
The client subscribes once on startup and uses events to invalidate
its in-memory projection.

Heartbeats every 15s keep idle connections alive. Auth is via
`risu-auth` query string (so EventSource works) or header (for
fetch-based subscribers).

## Boundary rules

Server owns:

- Persisted state. The browser never writes to localForage in
  server-backed mode.
- Provider API keys. Bootstrap masks them under
  `RISU_MASK_SERVER_KEYS=1` once Phase 6 has covered every provider
  the user relies on.
- Outbound HTTP for generation. The browser does not call provider
  APIs directly in server-backed mode.
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

- `move-to-fastify`'s [`server/fastify/`](https://github.com/) tree
  is a worked example of the module split above. It is denser than
  we need (e.g. it ships a whole-state bridge, multiple compatibility
  shims, and group-chat commands). Use it to read concrete code, not
  to set the API contract.
- `risuai-metatron`'s `chat_generation/` split
  (`generation_validation`, `message_state`, `prompt_builder`,
  `prompt_sections`, `prompt_history`, `prompt_templates`,
  `prompt_budget`, `lorebook`, `tokenizer`, `providers`,
  `generation_lifecycle`, `postprocess`) is the closest existing
  template for Phase 5 + Phase 7's TypeScript shape.
