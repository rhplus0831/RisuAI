# Migration Plan

Date: 2026-05-26

## Goal

Move Risuai from a thick browser app that owns persistence, provider
calls, and prompt assembly into a Fastify server that owns those
concerns. The browser keeps UI ownership and nothing else.

End state:

- Fastify owns persisted generation, provider dispatch, prompt and
  lorebook assembly, Hypa V3 memory, tokenization, and outbound
  HTTP (including the Risu hub passthrough).
- The browser owns rendering, input, abort forwarding, local display
  state, and browser-only effects (TTS playback, image preview).
- `src/ts/process/index.svelte.ts::sendChat` is a thin bridge that
  forwards intent to the server and applies SSE patches. The
  generation pipeline lives in focused server modules with
  fixture-backed tests.
- Group chat, peer multi-user chat, Risu Account Sync, Google Drive
  sync, and the Supa / Hypa V2 / Hanurai memory engine entry points
  are gone from the live surface.
- Tauri keeps working in its current local-storage mode without
  changes from this migration.

## Current Baseline

The live pickup snapshot belongs in [`status.md`](status.md). As of
2026-05-26, Phases 0-8 are closed and Phase 9 is active.

Stable baseline facts:

- `server/fastify/` is the live server path. Express and the old
  `runserver` script are gone.
- Fastify owns auth, bootstrap, JSON and multipart `.risu` import,
  repository `.risu` export, bundle export, assets, backups, proxy /
  stream-job / hub routes, legacy storage compatibility, completion
  generation, chat generation, preview-prompt, and Hypa V3 memory queue
  surfaces.
- Phase 8 closed with server memory tables, read/job routes,
  summarize/embed handlers, prompt-memory selection, and live
  chunk-planning for fresh server-backed chats.
- Phase 9 has landed command coverage through the 9-4 resource families,
  the 9-5 projection stream/guard work, the 9-6 server-backed storage and
  provider-secret gates, and the 9-7/9-8 server `.risu` codec,
  multipart import, repository export, asset-reference, and bundle export
  work. Covered command families include settings, presets, prompt items,
  personas, translator presets, loadouts, characters, chats, messages,
  generation persistence, scriptstate, lorebooks, scripts/triggers,
  modules, asset references, plugins, plugin storage, and compatibility
  adapters.
- Domain state still uses the migration-window `data/db.json` blob for
  resources not yet extracted to SQL. Memory uses dedicated SQL tables
  added in Phase 8.
- The browser keeps the `sendChat` UI coordinator, but Phase 6 owns
  completion dispatch and Phase 7 owns prompt assembly / chat dispatch
  when server-backed gates are enabled.
- Current route, provider, fixture, and test inventories live under
  [`coverage/`](coverage/). Historical slice detail lives in
  [`phases-completed/`](phases-completed/).

## Sequence

Phases run in order. Each phase has its own doc under
[`phases/`](phases/) with scope, exit criteria, and inline boundary
rules. The headline order:

0. **Removals** - delete Group chat, peer multi-user chat, Risu
   Account Sync, Google Drive sync, and Supa / Hypa V2 / Hanurai. Done
   on the client side, before any server work, so the surface that
   gets ported is smaller. See
   [`phases/phase-0-removals.md`](phases/phase-0-removals.md).
1. **Foundation** - scaffold the Fastify server, decide auth shape,
   pick the persistence layout, ship the health check. Done
   2026-05-20.
2. **Storage, import, assets, backups** - `data/db.json` blob for
   domain state, repository API, content-addressed assets, JSON
   save import, backups, Fastify static serving, and container
   switchover. Done server-side on 2026-05-20. No domain SQL schema
   yet; per-resource tables land later as server APIs need durable
   shapes. The server stayed JSON-native through Phase 2; binary
   `.risu` codec, import/export, asset walking, and bundle export work
   landed in Phase 9.
3. **Proxy migration** - move provider proxy and Risu hub
   passthrough behind Fastify; keep the stream-job WebSocket
   contract. Done 2026-05-21, including Fastify legacy storage /
   crypto compatibility and Express deletion.
4. **sendChat tests** - pin observable behavior of the current
   `sendChat` with fixtures and snapshots before any extraction.
   Done 2026-05-20 with 17 initial fixtures; Phase 5 has since
   added nine narrow gate fixtures, and Phase 6 has added twelve
   provider parity fixtures.
5. **sendChat extraction** - carve the function into stage-shaped
   modules behind the pinned tests. Done 2026-05-22 with all 28
   slices landed through `a7e2831d`.
6. **Server-side generation** - move provider dispatch plus
   tokenizer, translation, TTS, and image helper calls server-side.
   The `/api/v1/generate/completion` slice closed on 2026-05-22;
   helper routes for translation, TTS, image, token counting, and
   trigger execution remain follow-up slices that do not block
   Phase 7.
7. **Server-side prompt assembly** - server walks the preset's
   `promptTemplate`, lorebook activation, persona, memory, and
   triggers. Closed 2026-05-24.
8. **Memory** - Hypa V3 chunking, embeddings, summarization as an
   async job queue on the server. Closed 2026-05-25.
9. **Client thinning** - replace remaining `DBState.db.*` mutation
   with commands; cut the whole-state save bridge; client becomes a
   projection of server events. Active.

## Non-goals

- Multi-tenant deployment. The first server is single-user.
- Real-time collaborative editing.
- Background workers other than Hypa V3 memory.
- Schema-driven generated API clients. Hand-written typed helpers
  are fine at this scale.
- Re-implementing peer sync server-side. The peer feature is being
  removed, not relocated.
- Tauri changes. The desktop client keeps its current paths.

## Risks

- **sendChat hidden coupling.** The function reaches into stores,
  globals, and side effects that don't show up in its signature.
  Phase 4 is built around discovering these via fixtures rather than
  reading the code top-to-bottom.
- **Provider drift.** Each upstream LLM API has its own streaming
  quirks. Phase 6 ports one provider family at a time, each behind
  fixtures that record real upstream response shapes.
- **Migration scope creep.** It is tempting to fold "while we're
  here" cleanups into each phase. Phase boundaries are exit
  criteria, not invitations to refactor unrelated code.
- **Tauri silently breaking.** Tauri is out of scope but shares many
  source files. Each phase must confirm Tauri still builds before
  closing.

## Verification commands

Run before closing any browser-only slice:

```bash
pnpm check          # svelte-check + tsc
pnpm test           # frontend vitest
pnpm build          # vite build
```

Run `pnpm api:test` as well for Fastify server slices.

Tauri build is verified manually at phase boundaries.

## Reference notes

- The `move-to-fastify` branch already implements Phases 1-6 in one
  agent-driven push (68 commits ahead of `main`). Use specific
  commits as references for "here's one way to do this"; the API
  shape on this roadmap is intentionally redesigned (see
  [`architecture.md`](architecture.md)).
- The `risuai-metatron` Python fork at `/home/codex/risuai-metatron`
  decomposed `sendChat` into stage modules
  (`generation_validation`, `message_state`, `prompt_builder`,
  `providers`, `generation_lifecycle`, `postprocess`, etc.). That
  module split is a useful starting shape for Phase 5; we are not
  copying its FastAPI route layout.
