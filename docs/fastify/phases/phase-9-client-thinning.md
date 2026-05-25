# Phase 9 - Client Thinning

Date: 2026-05-25

Status: active. Next slice: **9-0 - Mutation inventory and command map**.

## Goal

Reduce the browser client to a projection of server state. Every durable
mutation goes through a typed command endpoint; in-memory `DBState` is
rebuilt from `/api/v1/bootstrap` plus server events; server-backed web
mode stops using local-storage persistence paths.

## Preconditions

- Phases 2, 6, 7, and 8 are closed.
- Server-owned prompt assembly, generation dispatch, and memory reads are
  stable enough that browser state can become a projection.

## Scope

### Server-Owned Commands

Add typed command endpoints for every durable mutation surface the
browser currently performs directly on `DBState.db`. Pattern:

- `POST /api/v1/commands/<resource>` - create or invoke.
- `PATCH /api/v1/commands/<resource>/:id` - partial update.
- `PUT /api/v1/commands/<resource>/:id/<child>` - replace a child
  collection.
- `DELETE /api/v1/commands/<resource>/:id` - remove.
- `POST /api/v1/commands/<resource>/reorder` - reorder ids.

Every command accepts `baseRevision`, runs in one transaction, returns
409 with `currentRevision` on stale input, emits a server event on
success, and has a typed browser helper under `src/ts/server/commands.ts`.

Resource families: settings, presets, prompt items, personas, loadouts,
characters, chats, messages, lorebooks, modules, plugins,
plugin-storage kv, assets, backup/import helpers, and any other durable
state family identified by 9-0. Group chat remains removed.

### Browser Projection

- Load `/api/v1/bootstrap` on web startup through
  `src/ts/server/bootstrap.ts`.
- Subscribe to `/api/v1/events` through `src/ts/server/events.ts`.
- On server events, debounce a bootstrap re-fetch. Surgical event patches
  are a future optimization.
- Turn on a read-only `DBState.db` guard in server-backed web mode after
  mutation replacement is complete.

### Storage And Key Gating

- Stop server-backed web startup, save, backup, restore, asset, and import
  paths from reaching localForage / OPFS / AutoStorage / NodeStorage.
- Route asset bytes through the Fastify asset API and durable resource
  references through commands.
- Mask provider secrets in `/api/v1/bootstrap` once every server-backed
  provider path can operate without client-visible keys.

### Server-Side `.risu` Codec

Move `.risu` encode/decode to the server once the client is no longer the
owner of a full mutable database snapshot:

- Port the legacy and RISUSAVE block codec with server-safe Node APIs.
- Decode imports into the Phase 9 per-resource command/import shape.
- Export repository-backed `.risu` files and ZIP bundles with real asset
  references.
- Drop localForage cache lookup and Tauri remote-file branches from the
  server codec.

### Tauri

Tauri keeps its current localForage path. Phase 9 gates server-backed web
behavior without changing the local desktop storage path.

## Difficulty Re-Check

Phase 9 is not a single "add commands" task. A quick audit found hundreds
of direct `DBState.db` mutation candidates before separating tests and
local-only paths. Treat command design, projection, storage gating,
provider-key masking, and the server `.risu` codec as separate rollback
surfaces.

## Slice Plan

- **9-0 - Mutation inventory and command map.** Planning gate only. Build
  the mutation inventory, classify each write site, lock endpoint names,
  payload shapes, id-vs-index rules, child replacement behavior, reorder
  semantics, conflict behavior, event names, and slice ownership. Include
  `setDatabase` / `setDatabaseLite` and plugin database setters because
  they bypass property-level grep.
  - Plugin-write strategy is a translation bridge: keep the plugin-facing
    API, parse allowed top-level keys, dispatch typed commands, and route
    unknown keys to `pluginCustomStorage`. 9-0 records the mapping table;
    implementation lands in 9-4f.
- **9-1 - Command foundation.** Add command route plumbing,
  `baseRevision` / 409 handling, transactions, revision increments, event
  emission, and the typed browser command helper. Ship one small settings
  command as the harness test.
- **9-2 - Settings, presets, personas, loadouts.** Move lower-churn global
  configuration families behind commands.
  - **9-2a - Scalar settings groups.** Split into secrets/providers,
    runtime tunables, and cosmetic / auxiliary groups. API-key placeholders
    mean "leave unchanged" once masking is active.
  - **9-2b - Bot presets.** Create/update/delete/reorder/select/copy/import
    preset flows, preserving current selected-preset behavior.
  - **9-2c - Prompt templates/items.** Template enablement, prompt-item
    create/update/delete/reorder, and prompt-setting fields directly tied
    to template behavior.
  - **9-2d - Personas.** Persona create/update/delete/reorder/select plus
    mirror fields and import/export behavior.
  - **9-2e - Translator presets.** Preset create/rename/delete/select and
    legacy-field sync. Runtime translation calls stay out of scope.
  - **9-2f - Loadouts.** Save/delete/favorite/list/last-used bookkeeping;
    apply is composite or deferred until every touched resource command
    exists.
- **9-3 - Characters, chats, messages.** Move high-churn chat resources
  behind commands.
  - **9-3a - Character catalog and scalar profile.** Character lifecycle,
    selection, ordering, and non-collection profile fields.
  - **9-3b - Chat records, folders, and metadata.** Chat lifecycle, folder
    operations, notes, persona binding, bookmarks, and chat-level metadata.
  - **9-3c - Message history commands.** User-visible transcript append,
    edit, delete, truncate, disable, role, bookmark, fork, and prompt-info
    edits.
  - **9-3d - Generation persistence handoff.** Split message-row writes,
    streaming state, and reroll/post-generation metadata. Preserve the
    sendChat fixture guardrails across the full group.
  - **9-3e - Chat `scriptstate` and scripting side effects.** Runtime
    script variable and chat-state writes; trigger definitions stay in 9-4.
  - **9-3f - Compatibility setters and access adapters.** Replace helper,
    plugin, and MCP character/chat mutation bypasses with commands or
    explicit unsupported behavior.
- **9-4 - Lorebooks, modules, plugins, assets.** Move child collections,
  extension surfaces, and resource-heavy commands.
  - **9-4a - Lorebook collection commands.** Global, character, chat, and
    module lorebook edits plus import/export handoff.
  - **9-4b - Script and trigger definition commands.** Character and module
    definition editing, import/export, reorder, and bulk replacement.
  - **9-4c - Module records and enablement.** Module lifecycle,
    enablement, active-module helpers, and compatibility paths.
  - **9-4d - Asset reference commands.** Database references to already
    uploaded asset bytes. Bundle walking stays in 9-8.
  - **9-4e - Plugin records and configuration.** Install, enable/disable,
    remove, provider selection, arguments, and plugin config UI writes.
  - **9-4f - Plugin-storage kv and plugin database adapters.** Implement
    the 9-0 translation bridge and composite mixed-resource command, then
    wire plugin API callers and tests.
  - **9-4g - Compatibility sweep and focused tests.** Prove no remaining
    direct server-backed web writes for 9-4 families before projection
    enforcement.
- **9-5 - Browser projection.** Turn the web client into a projection.
  - **9-5a - Events endpoint.** Build persistent SSE transport, then
    command event fan-out and the per-resource event catalog.
  - **9-5b - Bootstrap projection loader.** Load `/api/v1/bootstrap` on
    startup through a server helper.
  - **9-5c - Event subscription and debounced re-bootstrap.** Re-fetch
    bootstrap on events; do not patch state surgically.
  - **9-5d - Residual command replacement sweep.** Replace remaining
    server-backed web writes assigned to 9-2 through 9-4.
  - **9-5e - Read-only `DBState.db` guard.** Fail loudly for direct web-mode
    mutation attempts while leaving Tauri/local mode untouched.
- **9-6 - Storage and provider-key gating.** Audit and gate remaining
  localForage / OPFS / AutoStorage / NodeStorage consumers, route asset and
  import entrypoints server-side, resolve miscellaneous caches or plugin
  storage helpers, and flip provider-key masking only after all server
  provider paths are ready.
- **9-7 - Server `.risu` codec core.** Build fixture corpus, legacy
  envelope codec, RISUSAVE block codec, decode normalization, validation,
  repository-backed export adapter, and round-trip parity tests. The
  repository-backed export adapter is blocked on the relevant 9-2, 9-3,
  and 9-4 resource repositories.
- **9-8 - Import/export routes and bundle assets.** Add
  `/api/v1/export/risusave`, `/api/v1/export/bundle`, and multipart
  `/api/v1/import/risusave`; walk real asset references instead of
  over-including.
- **9-9 - Full server-backed fixture sweep and closeout.** Run the browser
  against bootstrap/events/commands/generation/memory, verify no web-mode
  localForage writes, manually verify Tauri local mode, and close the
  migration docs.

## Boundaries

- **No event-driven optimization.** Debounced re-bootstrap is the Phase 9
  target. Per-event patching is future work.
- **No removal of `localforage` from the bundle.** Tauri still uses it.
- **No new resources.** Commands are for existing product data.
- **No group-chat commands.** Group chat remains removed.
- **No plugin code execution server-side.** Plugin code remains browser
  sandboxed; only durable plugin state moves through commands.

## Exit Criteria

- Every direct `DBState.db.*` mutation in `src/lib/` and `src/ts/`
  outside Tauri/local-only code is replaced by a command call.
- Command tests cover representative auth, revision conflict, child
  replacement, reorder, and rollback behavior.
- The fully server-backed client runs against bootstrap, events, commands,
  generation, and memory with no server-mode localForage writes.
- A user can import a `.risu` save, chat, regenerate, edit messages,
  switch characters, change settings, and persist every change in the
  server data store.
- `pnpm check`, `pnpm test`, `pnpm api:test`, and `pnpm build` are green.
- Tauri local-storage mode still builds and is manually verified.

## Reference

- Active handoff: [`../status/next-steps.md`](../status/next-steps.md)
- `move-to-fastify`'s `COMMANDS.md` and projection store are references,
  not binding API contracts.
