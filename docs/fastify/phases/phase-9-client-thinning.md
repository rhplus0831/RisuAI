# Phase 9 - Client Thinning

Date: 2026-05-20

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

### Tauri

Tauri keeps its current localForage path untouched. The build flag
that selects "server-backed web" vs "Tauri local" stays. The
`forageStorage` gating mentioned above only triggers in the web
build.

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
