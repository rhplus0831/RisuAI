# Phase 9 - Client Thinning

Date: 2026-05-23

## Goal

Reduce the browser client to a projection of server state. Every
mutation goes through a typed command endpoint; the in-memory
`DBState` is rebuilt from `/api/v1/bootstrap` + SSE events; the
local-storage fallback is gone in server-backed mode.

## Preconditions

- Phases 2, 6, 7, 8 closed (server owns persistence + generation +
  prompt + memory).

## Scope

### Server-owned commands

Add typed command endpoints for every mutation surface the browser
currently performs directly on `DBState.db`. Pattern:

- `POST /api/v1/commands/<resource>` - create.
- `PATCH /api/v1/commands/<resource>/:id` - partial update.
- `PUT /api/v1/commands/<resource>/:id/<child>` - replace a child
  collection (lorebook entries, scripts, triggers, assets).
- `DELETE /api/v1/commands/<resource>/:id` - remove.
- `POST /api/v1/commands/<resource>/reorder` -
  `{ ids[] }` reassigns sort order.

Resources (final list locked when Phase 9 starts):

- character, chat, message, preset, prompt-item, module, plugin,
  persona, loadout, settings (per group), plugin-storage kv,
  backup.

No group-chat commands; group chat does not exist anymore.

Every command:

1. Accepts `baseRevision` in the body; returns 409 with
   `currentRevision` if stale.
2. Runs in a single transaction.
3. Emits an SSE event on success.
4. Has a typed client helper under `src/ts/server/commands.ts`.

### Browser projection

- `src/ts/server/bootstrap.ts` loads `/api/v1/bootstrap` on app
  start.
- `src/ts/server/events.ts` subscribes to `/api/v1/events`. Each
  event triggers a debounced bootstrap re-fetch (simplest correct
  thing). Optimization to surgical patches is a follow-up.
- `src/ts/bootstrap.ts` switches its `setDatabase` calls to come
  from the server bootstrap helper.
- `DBState.db` is read-only in server-backed mode. Direct mutation
  paths (`DBState.db.characters.push(...)`) become command calls.

### Delete the bridges

- The whole-state save bridge that `move-to-fastify` keeps for
  parity is not in this roadmap to begin with - we never built it.
  If Phase 2's import endpoint becomes the de-facto bridge during
  migration, this phase retires it once every mutation has a
  command.
- `forageStorage` reads in `globalApi.svelte.ts`,
  `storage/autoStorage.ts`, `characterCards.ts` get gated behind
  `if (!isFastifyServer)` and stop running on the web build.
- The `RISU_MASK_SERVER_KEYS=1` flag flips on once every provider
  in `model/modellist.ts` is server-routed.

### Server-side `.risu` codec

Phase 2 deliberately leaves `.risu` encode/decode in the client
(`src/ts/storage/risuSave.ts`); the client owns a complete
in-memory Database and can do the format conversion locally. Once
this phase makes the client a projection, that approach stops
working: the client no longer has the full Database to encode from,
and a "save export" feature has to be served by the server.

Phase 9 ships the codec server-side, designed against the
end-state per-resource SQL schema instead of the Phase 2
fat-Database shape. Concretely:

- `server/fastify/src/risuCodec.ts` ports the format from
  `src/ts/storage/risuSave.ts`, dropping the localforage-cache and
  Tauri-remote-file branches (which never made sense on the
  server) and adapting the encoder to read from per-resource
  repository methods.
- `GET /api/v1/export/risusave` returns the legacy single `.risu`
  blob for hub compatibility.
- `GET /api/v1/export/bundle` returns a ZIP with `save.risu`,
  every referenced asset, and a manifest. By Phase 9 the
  per-resource extraction has locked the asset-reference encoding,
  so the bundle can walk for real references instead of
  over-including.
- `POST /api/v1/import/risusave` widens to also accept multipart
  with a binary `.risu` blob + asset parts. The Phase 2 JSON path
  can be retired here too, since the multipart form covers
  imports of either origin.

The client-side `risuSave.ts` is one of the modules `forageStorage`
gating affects: web builds stop decoding/encoding locally, Tauri
keeps doing so.

### Tauri

Tauri keeps its current localForage path untouched. The build flag
that selects "server-backed web" vs "Tauri local" stays. The
`forageStorage` gating mentioned above only triggers in the web
build.

## Difficulty re-check

Phase 9 should not be picked up as "add typed commands" in one pass.
A quick mutation audit on 2026-05-23 found more than 500 direct
`DBState.db` mutation candidates across `src/lib/` and `src/ts/`
before separating tests and Tauri/local-only paths. The phase also
contains the projection store, localForage gating, provider-key
masking, and the server-side `.risu` codec. Those are separate
subsystems with different rollback risks.

Use this slice order when Phase 9 starts:

- **9-0 — Mutation inventory + command map.** Classify every direct
  `DBState.db` write as command-owned, Tauri/local-only, test-only,
  transient UI state, or obsolete. Lock the resource list and the
  command naming scheme before writing handlers.
- **9-1 — Command foundation.** Add command route plumbing,
  `baseRevision`/409 handling, transactions, revision increments,
  SSE event emission, and the typed client command helper. Ship one
  tiny settings command as the harness test.
- **9-2 — Settings, presets, personas, loadouts.** Move the global
  configuration families first: settings groups, bot presets,
  prompt templates/items, personas, loadouts, and translator-style
  preset state that belongs in the main database.
- **9-3 — Characters, chats, messages.** Move the high-churn chat
  resources: character create/update/delete/reorder, chat metadata,
  message edits, regeneration/continue patches, and `scriptstate`
  updates that survived Phase 7 triggers.
- **9-4 — Lorebooks, modules, plugins, assets.** Move child
  collections and resource-heavy commands: lorebook entries,
  character/module scripts, triggers, module/plugin state,
  plugin-storage kv, and asset reference updates. Keep plugin-defined
  resources out of scope.
- **9-5 — Browser projection.** Add `/api/v1/events`, the debounced
  bootstrap re-fetch client, read-only `DBState.db` guard in
  server-backed mode, and command-helper replacements for the
  mutation paths already covered by 9-2 through 9-4.
- **9-6 — Storage and provider-key gating.** Gate `forageStorage`,
  `autoStorage`, `globalApi.svelte.ts`, and character-card import
  paths behind the server/Tauri mode split. Flip
  `RISU_MASK_SERVER_KEYS=1` only after the provider matrix still
  works server-side.
- **9-7 — Server `.risu` codec core.** Port legacy/raw/compressed/
  stream decode and encode from `risuSave.ts`, adapting block
  traversal to server repositories and dropping localforage cache and
  Tauri remote-file branches.
- **9-8 — Import/export routes + bundle assets.** Add
  `/api/v1/export/risusave`, `/api/v1/export/bundle`, and multipart
  `/api/v1/import/risusave`; walk real asset references instead of
  over-including.
- **9-9 — Full server-backed fixture sweep + closeout.** Run the
  browser against bootstrap/events/commands/generation/memory, verify
  no web-mode localForage writes, manually verify Tauri local mode,
  and close the migration docs.

## Boundaries

- **No event-driven optimization.** Debounced re-bootstrap is the
  goal. Per-event patching is a future optimization, not a Phase
  9 deliverable.
- **No removal of `localforage` from the bundle.** Tauri still
  uses it. Tree-shaking by build flag is fine; outright dropping
  the dependency is not.
- **No new resources.** Phase 9 ships commands for what already
  exists. Adding plugin-defined resources or new feature data is
  separate work.
- **No breaking API changes.** SSE event shapes from Phase 7
  stay. Command request shapes are designed once and not
  renamed.

## Exit criteria

- Every direct `DBState.db.*` mutation in `src/lib/` and
  `src/ts/` (outside Tauri-gated code) is replaced by a command
  call.
- `pnpm test` covers a representative subset of commands
  (auth headers, revision conflict resolution, optimistic update
  rollback).
- The Phase 4 / 5 fixture set runs against a fully server-backed
  client: bootstrap loaded from server, generation routed through
  Phase 7's `chat` route, memory served by Phase 8's tables, every
  mutation through a command.
- A user can run `docker compose up`, open the SPA, set a
  password, import a `.risu` save, chat, regenerate, edit
  messages, switch characters, change settings, and have every
  change persist in the SQLite file - with no localForage writes.
- `pnpm check`, `pnpm test`, `pnpm build`, `pnpm api:test` green.
- Tauri build still works in local-storage mode (manual verify).

## Reference

- `move-to-fastify`'s `COMMANDS.md` lists a complete-ish set of
  endpoints. We adopt the same resource families but drop
  group-chat membership (Phase 0).
- `move-to-fastify`'s `src/ts/server/projection.ts` is one shape
  for the projection store; the debounced re-bootstrap pattern
  used there is what this roadmap defaults to.
