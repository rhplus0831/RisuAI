# Removed and Out-of-Scope Behavior

Date: 2026-05-22

This is the canonical registry of what the migration deletes and
what it intentionally does not touch. When a question comes up
about a feature ("should the server have a group-chat endpoint?",
"is Drive sync coming back?"), the answer should match this doc;
if it does not, fix this doc first.

## Removed in Phase 0

These features are deleted before the Fastify server is built.
They do not have server endpoints; they do not appear in the
final UI. Persisted data containing them loads (best effort) but
is not actively maintained.

- **Group chat.** Multi-character speaker-selection chats. Deleted
  along with `process/group.ts`, `groupOrder`, `groupOtherBotRole`,
  `characterTalks`, `characterActive`, and every `type === 'group'`
  branch in the live model / pipeline. Persisted group rows are
  filtered out by `setDatabase` on load, so they do not surface in
  the UI and are gone on the next save.
- **Peer-to-peer multi-user chat.** PeerJS-based shared chat
  sessions. `src/ts/sync/multiuser.ts` and the `peerjs`
  dependency are gone. The "Join Room" / "Create Room" UI
  entries are removed.
- **Risu Account Sync (Sionyw).** Cloud sync to the Sionyw account
  service. Deleted: `storage/accountStorage.ts`,
  `drive/accounter.ts`, `sionyw.ts`, the OAuth handlers in
  `server/node/server.cjs`, the "Risu Account" section of
  `Setting/Pages/UserSettings.svelte`. `openid-client` is removed
  if no consumer remains.
- **Google Drive sync.** Cloud backup to Drive. Deleted:
  `drive/drive.ts` and the "Save to Google Drive" / "Restore from
  Drive" UI entries. The former `drive/backuplocal.ts` local-backup
  helper moved to `storage/backup.ts` with Account Sync branches
  stripped. The replacement for cloud backup snapshots is the
  Fastify server's own `/api/v1/backups` (Phase 2); bundle export
  is deferred to Phase 9.
- **Supa memory, Hypa V2, Hanurai.** Legacy memory engines.
  Deleted: `process/memory/{supaMemory, hypav2, hanuraiMemory}.ts`
  and the selection branches in `process/index.svelte.ts`. Only
  Hypa V3 survives.

## Out of migration scope

These behaviors remain in tree and continue to work; the migration
does not extend or replace them.

- **Tauri / desktop builds.** Tauri keeps its current localForage
  storage path. Future server-backed-web branches must be gated so
  Tauri runs the same local-storage code it does today. Tauri is
  not actively tested at phase boundaries beyond "the bundle builds
  without errors".
- **Local-browser-only web mode.** Once the migration closes, the
  web client only runs against the Fastify server. Standalone
  browser mode (no server, IndexedDB-only) is not a target
  configuration. Existing tooling that supports it (the dev-only
  fallback) stays but is not maintained for parity with
  server-backed mode.

## Permanent no-port surfaces

These behaviors stay browser-only by design. The server does not
host them and never will under this roadmap.

- **TTS playback.** `sayTTS` audio playback. The server can call a
  TTS provider (Phase 6 `/api/v1/generate/tts`) and return the
  audio blob; playback happens in the browser's tab.
- **Image preview / inlay rendering.** `runInlayScreen`,
  `stableDiff` user-facing display. The server can call image
  generation providers (Phase 6 `/api/v1/generate/image`); the
  browser renders the result.
- **Browser image embedding.** `runImageEmbedding` from
  `@huggingface/transformers`. This is a `transformers.js` model
  loaded in the browser. The server does not run it.
- **WebLLM and Hugging Face `hf:::` local models.** In-browser LLMs
  via `@mlc-ai/web-llm` and `@huggingface/transformers`. The
  Phase 6 `/api/v1/generate/completion` route should keep these
  browser-local model families out of server dispatch and return
  501 if they are addressed by the server route.
- **Plugin code execution server-side.** Plugins that expose code
  hooks (`apiV3` plugins, character JS) run in the browser
  sandbox. The server gates plugin tool calls behind
  `plugins.low_level_access` + an MCP allowlist but does not
  execute the plugin code itself.
- **Dynamic Output.** Browser-only display feature; not server-
  routed.
- **Direct chat-input slash commands** outside `/send` and
  `/sendAs`. They are warning-only browser entries.

## What "removed" does not mean

- It does not mean a database migration script ships. Persisted
  databases that contain group / Sionyw / memory-engine fields
  load. Unknown fields are ignored on read and not written back
  on save.
- It does not mean a user's existing data is destroyed. Users who
  relied on Risu Account Sync are expected to export a `.risu`
  save before upgrading and re-import it against the new server.
- It does not mean the feature can be re-added later. The
  decisions are locked for this roadmap. Reopening means writing
  a new phase doc with the new direction.

## Reference

- `risuai-metatron/docs/send-chat-migration/unsupported-and-client-owned.md`
  is the structural inspiration. It catalogs both "we removed
  this" and "this stays browser-only" the same way this doc does.
- The `move-to-fastify` branch is more permissive than this
  roadmap. It ports group-chat membership commands and Sionyw
  auth. Where the two disagree, this doc wins.
