# Server Status

Date: 2026-05-27

Fastify is the only server runtime. Express and the old `runserver`
script are deleted.

## Route Surface

- **Auth / bootstrap:** health, auth setup/login/status, bootstrap
  (with provider secret masking), JSON and multipart `.risu` import,
  repository `.risu` export, bundle export.
- **Storage:** assets (upload/read/head/exists), backups (CRUD +
  restore with `state.restored` event), optional static SPA serving,
  legacy storage compatibility.
- **Proxy:** direct proxy fetch, stream-job WebSocket, Risu hub
  passthrough (auth-gated).
- **Generation:** `POST /api/v1/generate/completion` (provider dispatch
  + SSE envelope), `POST /api/v1/generate/chat` (prompt assembly +
  dispatch), `POST /api/v1/generate/preview-prompt` (JSON shortcut).
- **Memory:** job enqueue/list/cancel, chunk/summary reads. Worker
  handles `summarize` and `embed`; `chunk` is reserved/no-op.
- **Commands:** settings, presets, prompt items, personas, translator
  presets, loadouts, characters, chats, folders, messages, generation
  persistence, scriptstate, lorebooks, scripts/triggers, modules,
  plugins, plugin storage. All use `baseRevision` / 409 conflict.
- **Events:** `GET /api/v1/events` SSE stream for command and memory
  events.

## Watch Points

- Hub passthrough remains auth-gated; session-cookie support may be
  needed for browser-loaded hub resources.
- NovelAI text, NovelList, and Ooba OAI-compatible remain deferred
  until server-side prompt string flattening is available.
- Plugin / Lua execution and image generation side effects remain
  browser-only.

## References

- Route coverage: [`../coverage/server-routes.md`](../coverage/server-routes.md)
- Provider matrix: [`../coverage/providers.md`](../coverage/providers.md)
