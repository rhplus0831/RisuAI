# Removed and Out-of-Scope Behavior

Date: 2026-05-27

Canonical registry of deleted features and permanent browser-only
surfaces. If a question about a feature comes up, the answer should
match this doc.

## Removed

These features are deleted. They have no server endpoints and no UI.

- **Group chat.** Multi-character speaker-selection chats. All related
  code, fields, and UI removed. Persisted group rows are filtered on
  load and gone on save.
- **Peer-to-peer multi-user chat.** PeerJS-based shared sessions.
  Code and dependency removed.
- **Risu Account Sync (Sionyw).** Cloud sync deleted, including OAuth
  handlers and UI.
- **Google Drive sync.** Cloud backup to Drive deleted, including the
  `public/functions/drive.js` OAuth worker artifact.
- **Supa memory, Hypa V2, Hanurai.** Legacy memory engines removed.
  Hypa V3 is the only maintained engine. Some legacy field names remain
  as compatibility helpers consumed by Hypa V3.

## Removed by the Fastify-only lockdown (2026-05-27)

A follow-up effort removed the residual non-Fastify runtime surfaces
that the migration above left in place. Full detail lives in
[`../fastify-only/removed-and-out-of-scope.md`](../fastify-only/removed-and-out-of-scope.md).

- **Hono server subtree.** Node, Bun, Cloudflare, Vercel, and Wrangler
  entry points under `server/hono`, plus their package scripts.
- **Desktop and mobile wrappers.** Tauri/Electron launch scripts,
  `server.sh` / `server.bat`, and the Capacitor config.
- **Service worker and PWA local surfaces.** `public/sw.js`, the
  manifest `share_target` / `file_handlers` entries, `#share_*` and
  `launchQueue` import handlers, and standalone display mode.
- **Local browser persistence.** OPFS and localforage app-runtime
  storage selection, the local save-file bootstrap fallback, and local
  full/partial backup and restore-from-file flows.
- **Legacy client endpoint selection.** Client routing to `/api/write`,
  `/api/read`, `/api/list`, `/api/remove`, `/proxy2`, and
  `/proxy-stream-jobs`, plus the Cloudflare Pages-style hosted proxy
  functions in `public/functions`. Client IO now targets
  `/api/v1/storage/*` and `/api/v1/proxy/*` only.
- **Broad platform gates.** `isNodeServer`, `isTauri`, and `isWeb` are
  gone from `src/ts/platform.ts`; `globalThis.__FASTIFY__` is the single
  server-backed signal.

The server still ships `legacyStorage.ts` and `hub.ts` routes — they
back the retained `/api/v1/storage/*` and `/api/v1/hub/*` contracts; the
"legacy" name is historical, not a removed surface.

## Permanent browser-only surfaces

The server does not host these and never will under this roadmap.

- **TTS playback.** Audio playback stays in the browser tab.
- **Image preview / inlay rendering.** Browser renders results.
- **Browser image embedding.** `@huggingface/transformers` model in
  browser.
- **WebLLM and HF `hf:::` local models.** In-browser LLMs. Server
  returns 501 if addressed.
- **Plugin code execution.** Runs in browser sandbox. Server gates
  plugin tool calls but does not execute plugin code.
- **Dynamic Output.** Browser-only display feature.
- **Direct chat-input slash commands** outside `/send` and `/sendAs`.

## What "removed" does not mean

- No database migration script ships. Unknown fields are ignored on
  read and not written back on save.
- User data is not destroyed. Export a `.risu` save before upgrading
  and re-import it.
- Decisions are locked for this roadmap. Reopening means a new phase
  doc.
