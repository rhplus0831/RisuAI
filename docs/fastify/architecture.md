# Architecture

Date: 2026-05-27

Server module shape and boundaries between Fastify and the browser.
Route coverage: [`coverage/server-routes.md`](coverage/server-routes.md).

## Server module layout

```
server/fastify/
  src/
    index.ts            entry point
    app.ts              Fastify app factory
    config.ts           env loading
    db.ts               node:sqlite handle
    auth.ts             password + signed-assertion auth
    http.ts             shared auth/header helpers
    repository.ts       db.json, assets, backups
    proxy.ts            generic proxy helpers
    streamJobs.ts       proxy stream-job registry
    routes/
      health.ts, auth.ts, bootstrap.ts, save.ts, assets.ts,
      backups.ts, proxy.ts, streamJobs.ts, hub.ts,
      legacyStorage.ts, generation.ts, generationChat.ts,
      memoryJobs.ts, memoryReads.ts, commands.ts, events.ts
    generation/         per-provider dispatch modules
    prompt/             prompt assembly, templates, lorebook, triggers
    memory*.ts          repositories, worker, planner, embeddings
    commands/           command validation, mutations, event catalog
```

## API surface

Routes versioned at `/api/v1/`. Revision-tracked mutations return the
new server revision. Route families:

- Health, auth, bootstrap, `.risu` import/export, bundle export.
- Assets, backups, optional static SPA serving, legacy storage.
- Proxy fetch, stream-job WebSocket, hub passthrough.
- Completion generation, chat/preview-prompt generation.
- Memory job/read routes.
- Command routes for all resource families.
- `GET /api/v1/events` command-event SSE stream.

Planned: helper routes for translate, TTS, image, token counting.

## Persistence

- **SQLite** (`data/risu.db`): schema metadata, revision, memory tables.
- **Domain state** (`data/db.json`): single JSON blob.
- **Assets** (`data/assets/<sha256>.<ext>`): content-addressed files.
- **Backups** (`data/backups/<id>/`): `db.json` snapshot + manifest.

## Auth

Single-user. Password set on first run; subsequent calls use ES256
client-signed assertions. Browser keeps keypair in localStorage.

## Events

`GET /api/v1/events` emits `event: command` frames with
`{ type, revision, resource, id?, parentId? }`. The browser debounces
bootstrap re-fetches; per-event patching is future work.

## Boundary rules

Server owns: persisted state, provider API keys, outbound HTTP for
covered providers, prompt assembly, tokenization, lorebook activation,
Hypa V3 memory.

Browser owns: rendering, input, abort forwarding, local display state,
TTS playback, image preview, browser image embedding, plugin code
execution.

Removed: group chat, peer sync, Drive sync, Risu Account Sync,
Tauri / Desktop.
