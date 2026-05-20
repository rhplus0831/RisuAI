# Migration Plan

Date: 2026-05-20

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
  sync, and the Supa / Hypa V2 / Hanurai memory engines are gone
  from the tree.
- Tauri keeps working in its current local-storage mode without
  changes from this migration.

## Baseline

Where the codebase stands at the start of this roadmap (2026-05-20,
branch `fastify`):

- No Fastify server exists. `server/node/server.cjs` (Express) and the
  near-empty `server/hono/` scaffold are what's checked in.
- `src/ts/process/index.svelte.ts` is **2245 lines** in a single
  `sendChat` function with explicit `stage1`-`stage4` timing markers.
- Removal targets are reachable from the live UI:
  - Group chat: 49 `type === 'group'` sites in `src/ts/`, ~20 in
    `src/lib/`; pipeline glue in `src/ts/process/group.ts`;
    `groupOtherBotRole`/membership in settings.
  - Peer multi-user chat: `src/ts/sync/multiuser.ts` (440 LOC),
    PeerJS dependency, four call sites inside `sendChat`, five Svelte
    components.
  - Risu Account Sync: `src/ts/storage/accountStorage.ts` (211 LOC),
    `src/ts/drive/accounter.ts` (137 LOC), `src/ts/sionyw.ts` (342
    LOC), plus settings UI.
  - Google Drive sync: `src/ts/drive/drive.ts` (453 LOC),
    `src/ts/drive/backuplocal.ts` (512 LOC).
  - Legacy memory engines: `src/ts/process/memory/{supaMemory,
hypav2, hanuraiMemory}.ts`.

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
   pick the persistence layout, ship the health check.
2. **Storage, import, export, assets** - SQLite schema, repository
   API, content-addressed assets, Risu save import/export.
3. **Proxy migration** - move provider proxy and Risu hub
   passthrough behind Fastify; keep the stream-job WebSocket
   contract.
4. **sendChat tests** - pin observable behavior of the current
   `sendChat` with fixtures and snapshots before any extraction.
5. **sendChat extraction** - carve the function into stage-shaped
   modules behind the pinned tests.
6. **Server-side generation** - move provider dispatch, tokenizer,
   translation, TTS, image, and Stable Horde calls server-side.
7. **Server-side prompt assembly** - server walks the preset's
   `promptTemplate`, lorebook activation, persona, memory, and
   triggers.
8. **Memory** - Hypa V3 chunking, embeddings, summarization as an
   async job queue on the server.
9. **Client thinning** - replace remaining `DBState.db.*` mutation
   with commands; cut the whole-state save bridge; client becomes a
   projection of server events.

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

Run before closing any phase slice:

```bash
pnpm check          # svelte-check + tsc
pnpm test           # frontend vitest
pnpm api:test       # server vitest (added in Phase 1)
pnpm build          # vite build
```

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
