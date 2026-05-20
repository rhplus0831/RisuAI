# Migration Plan

Date: 2026-05-21

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

## Current Baseline

Where the codebase stands after the Phase 3 closeout on 2026-05-21
and the Phase 4 characterization slice on 2026-05-20:

- `server/fastify/` exists with app boot, config loading,
  `node:sqlite` schema metadata, password + ES256 assertion auth,
  `GET /api/v1/health`, `GET /api/v1/auth/status`,
  `POST /api/v1/auth/setup`, `POST /api/v1/auth/login`,
  `GET /api/v1/bootstrap`, JSON `POST /api/v1/import/risusave`,
  raw asset routes, backup routes, `POST /api/v1/proxy/fetch`,
  proxy stream-job HTTP + WebSocket routes, `ANY /api/v1/hub/*`,
  versioned legacy storage routes, `POST /api/v1/auth/crypto`,
  and optional static SPA serving.
- `server/fastify/src/repository.ts` owns the migration-window
  `data/db.json` blob, content-addressed `data/assets/`, and
  `data/backups/`. `data/risu.db` still holds system metadata only:
  `schema_version(id, version, revision)`.
- Root `package.json` has `api:dev`, `api:start`, and `api:test`
  for the Fastify server. The Docker image and compose file run
  `pnpm api:start` on port 6002 with `/app/data` persisted. The
  legacy `runserver` script and `server/node/` Express server have
  been removed. `server/hono/` remains a separate static-serving
  scaffold and is not the migration path.
- `src/ts/process/index.svelte.ts` is **2090 lines** in a single
  `sendChat` function with explicit `stage1`-`stage4` timing markers.
- `src/ts/process/__tests__/sendChat.fixtures.test.ts` now pins
  the current `sendChat` behavior with 17 fixtures under
  `src/ts/process/__fixtures__/`. Phase 5 extraction can proceed
  behind that harness.
- Phase 0 removal targets are deleted from the live pipeline:
  - `src/ts/process/group.ts`, `src/ts/sync/multiuser.ts`,
    `src/ts/storage/accountStorage.ts`, `src/ts/sionyw.ts`, and
    `src/ts/drive/` are gone.
  - `peerjs` and `openid-client` are no longer dependencies.
  - `src/ts/process/memory/{supaMemory,hypav2,hanuraiMemory}.ts`
    are gone; only Hypa V3 remains as the active memory engine.
  - A few inert compatibility names remain by design, such as
    `supaMemory` as the per-chat Hypa V3 enable flag and
    `memo: 'supaMemory'` protocol tags.
  - Current known cleanup debt: stale, unreachable UI checks for
    `char.type === 'group'` remain in `src/lib/Others/ChatList.svelte`
    and `src/lib/Others/GridCatalog.svelte`; prompt-toggle
    `type === 'group'` tokens in `src/lib/SideBars/Toggles.svelte`
    and `src/ts/util.ts` are unrelated to chat groups.

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
   yet; per-resource tables land in Phases 5-9. The binary `.risu`
   codec and bundle export stay out of the server until Phase 9 -
   the server is JSON-native through Phase 2.
3. **Proxy migration** - move provider proxy and Risu hub
   passthrough behind Fastify; keep the stream-job WebSocket
   contract. Done 2026-05-21, including Fastify legacy storage /
   crypto compatibility and Express deletion.
4. **sendChat tests** - pin observable behavior of the current
   `sendChat` with fixtures and snapshots before any extraction.
   Done 2026-05-20 with 17 fixtures.
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
