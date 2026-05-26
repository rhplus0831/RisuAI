# Phase 9 - Client Thinning

Date: 2026-05-26

Status: active. Last landed work:
**9-5e-iii - Guard audit closeout**. Next pickup:
**9-6a - Server-backed persistence gate**.

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
- In 9-5c, subscribe to `/api/v1/events` through
  `src/ts/server/events.ts`.
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
  - Status: complete. Locked command map:
    [`../status/phase-9-command-map.md`](../status/phase-9-command-map.md).
- **9-1 - Command foundation.** Add command route plumbing,
  `baseRevision` / 409 handling, transactions, revision increments, event
  emission, and the typed browser command helper. Ship one small settings
  command as the harness test.
  - Status: complete. Closeout:
    [`../phases-completed/phase-9-client-thinning-9-1.md`](../phases-completed/phase-9-client-thinning-9-1.md).
- **9-2 - Settings, presets, personas, loadouts.** Move lower-churn global
  configuration families behind commands.
  - **9-2a - Scalar settings groups.** Split into secrets/providers,
    runtime tunables, and cosmetic / auxiliary groups. API-key placeholders
    mean "leave unchanged" once masking is active.
    - **9-2a-i - Scalar settings command groups.** Complete. Generalized
      `PATCH /api/v1/commands/settings/:group`, added grouped allowlists and
      browser helper support, and routed data-driven settings wrappers through
      commands in Fastify mode. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-2a-i.md`](../phases-completed/phase-9-client-thinning-9-2a-i.md).
    - **9-2a-ii - Manual scalar settings pages.** Complete. Added the shared
      manual settings bridge, extended scalar maps for manual provider/runtime/
      media/account fields, and registered Fastify-only command watchers for
      the named manual settings surfaces. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-2a-ii.md`](../phases-completed/phase-9-client-thinning-9-2a-ii.md).
  - **9-2b - Bot presets.** Create/update/delete/reorder/select/copy/import
    preset flows, preserving current selected-preset behavior.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-2b.md`](../phases-completed/phase-9-client-thinning-9-2b.md).
  - **9-2c - Prompt templates/items.** Template enablement, prompt-item
    create/update/delete/reorder, and prompt-setting fields directly tied
    to template behavior.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-2c.md`](../phases-completed/phase-9-client-thinning-9-2c.md).
  - **9-2d - Personas.** Persona create/update/delete/reorder/select plus
    mirror fields and import/export behavior.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-2d.md`](../phases-completed/phase-9-client-thinning-9-2d.md).
  - **9-2e - Translator presets.** Preset create/rename/delete/select and
    legacy-field sync. Runtime translation calls stay out of scope.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-2e.md`](../phases-completed/phase-9-client-thinning-9-2e.md).
  - **9-2f - Loadouts.** Save/delete/favorite/list/last-used bookkeeping;
    apply is composite or deferred until every touched resource command
    exists.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-2f.md`](../phases-completed/phase-9-client-thinning-9-2f.md).
- **9-3 - Characters, chats, messages.** Move high-churn chat resources
  behind commands.
  - **9-3a - Character catalog and scalar profile.** Character lifecycle,
    selection, ordering, and non-collection profile fields.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-3a.md`](../phases-completed/phase-9-client-thinning-9-3a.md).
  - **9-3b - Chat records, folders, and metadata.** Chat lifecycle, folder
    operations, notes, persona binding, bookmarks, and chat-level metadata.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-3b.md`](../phases-completed/phase-9-client-thinning-9-3b.md).
  - **9-3c - Message history commands.** User-visible transcript append,
    edit, delete, truncate, disable, role, bookmark, fork, and prompt-info
    edits.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-3c.md`](../phases-completed/phase-9-client-thinning-9-3c.md).
  - **9-3d - Generation persistence handoff.** Split message-row writes,
    streaming state, and reroll/post-generation metadata. Preserve the
    sendChat fixture guardrails across the full group.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-3d.md`](../phases-completed/phase-9-client-thinning-9-3d.md).
  - **9-3e - Chat `scriptstate` and scripting side effects.** Runtime
    script variable and chat-state writes; trigger definitions stay in 9-4.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-3e.md`](../phases-completed/phase-9-client-thinning-9-3e.md).
  - **9-3f - Compatibility setters and access adapters.** Replace helper,
    plugin, and MCP character/chat mutation bypasses with commands or
    explicit unsupported behavior.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-3f.md`](../phases-completed/phase-9-client-thinning-9-3f.md).
- **9-4 - Lorebooks, modules, plugins, assets.** Move child collections,
  extension surfaces, and resource-heavy commands.
  - **9-4a - Lorebook collection commands.** Global, character, chat, and
    module lorebook edits plus import/export handoff.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-4a.md`](../phases-completed/phase-9-client-thinning-9-4a.md).
  - **9-4b - Script and trigger definition commands.** Character and module
    definition editing, import/export, reorder, and bulk replacement.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-4b.md`](../phases-completed/phase-9-client-thinning-9-4b.md).
  - **9-4c - Module records and enablement.** Module lifecycle,
    enablement, active-module helpers, and compatibility paths.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-4c.md`](../phases-completed/phase-9-client-thinning-9-4c.md).
  - **9-4d - Asset reference commands.** Database references to already
    uploaded asset bytes. Bundle walking stays in 9-8.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-4d.md`](../phases-completed/phase-9-client-thinning-9-4d.md).
  - **9-4e - Plugin records and configuration.** Install, enable/disable,
    remove, provider selection, arguments, and plugin config UI writes.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-4e.md`](../phases-completed/phase-9-client-thinning-9-4e.md).
  - **9-4f - Plugin-storage kv and plugin database adapters.** Implement
    the 9-0 translation bridge and composite mixed-resource command, then
    wire plugin API callers and tests.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-4f.md`](../phases-completed/phase-9-client-thinning-9-4f.md).
  - **9-4g - Compatibility sweep and focused tests.** Prove no remaining
    direct server-backed web writes for 9-4 families before projection
    enforcement.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-4g.md`](../phases-completed/phase-9-client-thinning-9-4g.md).
- **9-5 - Browser projection.** Turn the web client into a projection.
  - **9-5a - Events endpoint.** Build persistent SSE transport, then
    command event fan-out and the per-resource event catalog.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-5a.md`](../phases-completed/phase-9-client-thinning-9-5a.md).
  - **9-5b - Bootstrap projection loader.** Load `/api/v1/bootstrap` on
    startup through a server helper.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-5b.md`](../phases-completed/phase-9-client-thinning-9-5b.md).
  - **9-5c - Event subscription and debounced re-bootstrap.** Re-fetch
    bootstrap on events; do not patch state surgically.
    - Status: complete. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-5c.md`](../phases-completed/phase-9-client-thinning-9-5c.md).
  - **9-5d - Residual command replacement sweep.** Replace remaining
    server-backed web writes assigned to 9-2 through 9-4, but keep the
    work split by mutation family instead of treating the whole residual
    audit as one implementation change.
    - Status: complete. Residual passes routed character asset helper
      writes, legacy chat v1 imports, lorebook local activation, process/
      runtime durable writes, and MCP refresh-token persistence through
      existing commands or explicit server-backed gates.
    - **9-5d-i - Settings residual command sweep.** Complete. Routed
      residual settings-style writes in manual settings pages/components
      through existing settings command watchers and kept resource-owned
      fields on their dedicated command bridges. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-5d-i.md`](../phases-completed/phase-9-client-thinning-9-5d-i.md).
    - **9-5d-ii - 9-2 resource UI tails.** Complete. Audited prompt
      template, persona, translator preset, and loadout UI/helper writes
      against existing command helpers and rollback behavior, and tightened
      persona/translator delete selection payloads. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-5d-ii.md`](../phases-completed/phase-9-client-thinning-9-5d-ii.md).
    - **9-5d-iii - 9-3 character/chat UI tails.** Complete. Audited
      character profile/assets, chat folders, selected chat/page state,
      playground, realm/grid helpers, and legacy import helpers against
      existing 9-3 command bridges, fixed compact chat-list selection, and
      made cold-storage character hydration explicitly unsupported in
      server-backed web mode. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-5d-iii.md`](../phases-completed/phase-9-client-thinning-9-5d-iii.md).
    - **9-5d-iv - 9-4 extension UI/API tails.** Complete. Audited
      lorebook, module UI/MCP helper, plugin settings, plugin database
      translation, and plugin-storage writes against existing 9-4 bridges,
      routed plugin V3 theme APIs through settings commands, and covered
      `moduleIntergration` with the settings bridge. Closeout:
      [`../phases-completed/phase-9-client-thinning-9-5d-iv.md`](../phases-completed/phase-9-client-thinning-9-5d-iv.md).
    - **9-5d-v - Process/runtime durable-write classification.** Classify
      generation, scriptstate, memory, and MCP helper writes, then replace
      durable server-backed writes with message/generation/scriptstate or
      settings commands while leaving local/runtime-only state documented.
      - Status: complete. Closeout:
        [`../phases-completed/phase-9-client-thinning-9-5d-v.md`](../phases-completed/phase-9-client-thinning-9-5d-v.md).
  - **9-5e - Read-only `DBState.db` guard.** Fail loudly for direct web-mode
    mutation attempts while leaving Tauri/local mode untouched. Keep the
    guard work split so guard failures do not become an unbounded residual
    mutation sweep.
    - **9-5e-i - Projection write gate foundation.** Add the server-backed
      read-only guard primitive and trusted projection replacement helpers for
      bootstrap/event refresh writes. No residual write fixes, storage gating,
      or Tauri/local behavior changes.
      - Status: complete. Closeout:
        [`../phases-completed/phase-9-client-thinning-9-5e-i.md`](../phases-completed/phase-9-client-thinning-9-5e-i.md).
    - **9-5e-ii - Command bridge guard integration.** Route command-owned
      optimistic updates and rollback paths through trusted write scopes, or
      remove local writes where projection refresh is authoritative. No new
      command endpoints.
      - Status: complete. Closeout:
        [`../phases-completed/phase-9-client-thinning-9-5e-ii.md`](../phases-completed/phase-9-client-thinning-9-5e-ii.md).
    - **9-5e-iii - Guard audit closeout.** Enable the guard across the
      server-backed fixture path and classify failures as missed 9-5d residuals
      or intentional local/runtime-only state. Large resource replacements go
      back to follow-up residual slices.
      - Status: complete. Closeout:
        [`../phases-completed/phase-9-client-thinning-9-5e-iii.md`](../phases-completed/phase-9-client-thinning-9-5e-iii.md).
- **9-6 - Storage and provider-key gating.** Gate storage and key exposure in
  smaller rollback surfaces. Keep server `.risu` codec/import/export work in
  9-7/9-8.
  - **9-6a - Server-backed persistence gate.** Stop Fastify-served web startup,
    save, and backup maintenance from initializing or writing AutoStorage,
    OPFS, NodeStorage, or localForage. Tauri/local mode stays unchanged.
  - **9-6b - Asset byte gate.** Close remaining Fastify asset-helper gaps,
    especially reads that can still fall through to local storage. Durable
    asset references remain owned by 9-4d commands; bundle walking stays 9-8.
  - **9-6c - Server backup/restore projection.** Route server-backed backup UI
    and helper paths through `/api/v1/backups`, block local backup/restore in
    Fastify mode, and emit/handle restore invalidation.
  - **9-6d - Residual local cache classification.** Classify remaining
    localForage/cache helpers, including `.risu` cache/remotes, MCP helper
    storage, search credentials, cold-storage, and memory leftovers, as
    server-backed unsupported, server-owned, or runtime-local.
  - **9-6e - Provider secret masking.** Mask provider secret fields in
    `/api/v1/bootstrap` only after server-backed provider paths no longer need
    client-visible keys. Preserve settings-command placeholder semantics.
- **9-7 - Server `.risu` codec core.** Move the codec to server-safe Node
  modules before route wiring.
  - **9-7a - `.risu` fixture corpus and codec harness.** Add server-side
    fixtures for legacy raw/compressed/stream envelopes and RISUSAVE block
    saves. No import/export routes or repository writes.
  - **9-7b - Legacy envelope codec port.** Port raw and compressed legacy
    envelope encode/decode to server-safe APIs. No RISUSAVE block support yet.
  - **9-7c - RISUSAVE block codec port.** Implement server-safe block
    encode/decode for root, character, preset, module, loadout, plugin,
    plugin-storage, config, and root-component blocks. Reject or report
    remote/cache-only blocks instead of using localForage or Tauri paths.
  - **9-7d - Decode normalization and validation.** Convert decoded saves into
    current Phase 9 import snapshots/resource shapes and validate malformed
    rows and stable ids.
  - **9-7e - Repository-backed export adapter.** Build export snapshots from
    server persistence with server asset ids preserved as references. ZIP
    bundle generation and multipart import stay in 9-8.
- **9-8 - Import/export routes and bundle assets.** Wire the server codec to
  routes and real asset walking after 9-7 lands.
  - **9-8a - Multipart `.risu` import route.** Accept multipart uploads at
    `/api/v1/import/risusave`, decode through the 9-7 codec, apply normalized
    imports, and return revision plus real asset/missing reports.
  - **9-8b - Repository `.risu` export route.** Add
    `/api/v1/export/risusave` using the repository-backed export adapter. No
    ZIP bundle or asset file inclusion beyond codec references.
  - **9-8c - Asset reference walker.** Add a pure server helper that scans
    persisted database state for real Fastify asset ids and reports referenced,
    missing, and orphaned assets without over-including stored assets.
  - **9-8d - Bundle export route.** Add `/api/v1/export/bundle` with the
    `.risu` export, manifest/report, and only walked asset files.
- **9-9 - Full server-backed fixture sweep and closeout.** Treat closeout as a
  sequence of verification surfaces, not one implementation slice.
  - **9-9a - Server-backed browser smoke harness.** Add or document a
    repeatable browser-level smoke path for Fastify-served web startup,
    bootstrap/events, and one representative command mutation.
  - **9-9b - Generation and memory fixture closeout.** Re-run and reconcile
    server-backed sendChat, generation persistence, rollback, and Hypa V3
    memory fixture coverage.
  - **9-9c - Server-backed storage-write audit.** Prove Fastify web mode does
    not touch localForage, OPFS, AutoStorage, or legacy NodeStorage write paths
    during startup, commands, import/export, assets, generation, or memory.
  - **9-9d - Manual Fastify web and Tauri local verification.** Record manual
    import, chat, regenerate, edit, character switch, settings, persist, and
    reload checks for both modes.
  - **9-9e - Phase 9 docs closeout.** Update status, coverage, and completed
    phase docs after the closeout verification slices are green.

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
