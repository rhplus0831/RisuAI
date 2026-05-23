# Phase 9 - Client Thinning

Date: 2026-05-24

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

- **9-0 — Mutation inventory + command map.** This is a planning
  gate, not an implementation slice. Do not write command handlers,
  projection code, localForage gates, or `.risu` codec code here.
  Split it into the sub-slices below and close all of them before
  9-1 starts.
  - **9-0a — Mechanical mutation inventory.** Produce an inventory
    artifact for every direct `DBState.db` write candidate in
    `src/lib/` and `src/ts/`, excluding generated output. Record file,
    line, expression, enclosing UI/action path when obvious, resource
    family, and whether the site is write-like, ambiguous, test-only,
    Tauri/local-only, transient UI state, or obsolete. Include
    `setDatabase` / `setDatabaseLite` callers and plugin-exposed
    database setters because they bypass property-level grep.
  - **9-0b — Subsystem classification.** Review the inventory in
    ownership batches: settings/presets/personas/loadouts;
    characters/chats/messages; lorebooks/modules/plugins/assets;
    storage/import/export; process/runtime side effects; plugin/MCP
    access. Assign every non-test/non-obsolete write to a later Phase
    9 implementation slice.
  - **9-0c — Command map design.** Lock the command resource list,
    endpoint names, id-vs-index rules, payload shapes, child collection
    replacement rules, reorder semantics, `baseRevision` conflict
    behavior, and SSE event names before writing handlers. Prefer a
    small number of typed resource commands over one field-level patch
    endpoint per database property. **Also lock the plugin-write
    strategy** (gates 9-4f): given that `setDatabase` / `setDatabaseLite`
    today write at field level through a 26-entry whitelist
    (`src/ts/plugins/plugins.svelte.ts:37-61, 763-793`), pick one of
    (a) plugins call typed commands directly, (b) a translation bridge
    converts plugin writes into command calls and rejects unmappable
    fields, or (c) only `pluginCustomStorage` survives and the 25 other
    whitelisted keys become hard rejections. Record the choice in 9-0d.
  - **9-0d — Readiness checklist.** Publish the final command map and
    a coverage checklist that shows each mutation family is assigned to
    9-2a through 9-2f, 9-3a through 9-3f, 9-4a through 9-4g,
    9-5a through 9-5e, 9-6, or explicitly marked
    Tauri/local-only/test-only, transient, or obsolete. 9-1 is
    blocked until this checklist has no unknowns.
- **9-1 — Command foundation.** Add command route plumbing,
  `baseRevision`/409 handling, transactions, revision increments,
  SSE event emission, and the typed client command helper. Ship one
  tiny settings command as the harness test.
- **9-2 — Settings, presets, personas, loadouts.** Umbrella milestone
  for the lower-churn global configuration families. Do not pick this
  up as one implementation slice: the settings surface alone includes
  provider configuration, prompt controls, fallback models, sampler
  state, images, and auxiliary model state, while presets, prompt
  templates, personas, translator presets, and loadouts each have
  distinct rollback risks. Close the sub-slices below in order.
  - **9-2a — Scalar settings groups.** Move per-group scalar settings
    first with typed patch commands and client helpers. Cover provider
    selection, sampler/request options, prompt-related scalar fields,
    fallback model settings, UI/display settings that belong in the
    main database, and translator language mode. Do not move provider
    key masking, localForage gating, module/plugin state, asset-heavy
    imports, or read-only `DBState.db` enforcement here.
  - **9-2b — Bot presets.** Move bot preset create/update/delete/
    reorder/select/copy/import flows, preserving the current
    `saveCurrentPreset`, `changeToPreset`, and `setPreset` behavior
    where one selected preset snapshots and reapplies many global
    database fields. Include preset image fields only if they remain
    inline data URLs; defer content-addressed asset reference changes
    to 9-4/9-6 as appropriate.
  - **9-2c — Prompt templates/items.** Move prompt template enable/
    disable, prompt item create/update/delete/reorder, and prompt
    item child-field editing. Include `promptSettings` fields that
    directly gate prompt template behavior, such as
    `sendChatAsSystem`, `sendName`, `trimStartNewChat`,
    `utilOverride`, `customChainOfThought`, and
    `maxThoughtTagDepth`.
  - **9-2d — Personas.** Move persona create/update/delete/reorder/
    select plus the current persona mirror fields (`username`,
    `userIcon`, `personaPrompt`, `userNote`, `selectedPersona`).
    Preserve persona export/import behavior, but keep any new asset
    reference model out of this slice unless 9-0 explicitly assigns it
    here.
  - **9-2e — Translator presets.** Move translator preset create/
    rename/delete/select/import/export and the legacy-field sync
    between `translatorPresets`/`translatorPresetId` and
    `translatorPrompt`/`translatorMaxResponse`. Keep the translator
    cache and runtime translation calls out of scope.
  - **9-2f — Loadout records and apply handoff.** Move loadout save,
    delete, favorite, list, and last-used bookkeeping after preset and
    persona commands exist. Treat "apply loadout" as a composite
    command or defer it until every touched resource has landed:
    modules/global variables overlap 9-4, while preset and persona
    selection depend on 9-2b and 9-2d.
- **9-3 — Characters, chats, messages.** Umbrella milestone for the
  high-churn chat resources. Do not pick this up as one implementation
  slice: it spans character catalog/profile commands, chat and folder
  metadata, transcript edits, generation persistence, scripting side
  effects, and compatibility setters. Keep lorebook entries,
  character/module script definitions, trigger definitions,
  module/plugin state, plugin-storage kv, and asset reference model
  changes in 9-4 unless 9-0 explicitly assigns a tiny compatibility
  shim here. Close the sub-slices below in order.
  - **9-3a — Character catalog and scalar profile.** Move character
    create/delete/trash/restore/reorder/select plus scalar profile
    edits such as name, description, first message, author metadata,
    tags, visibility flags, view/display toggles, TTS scalar fields,
    and other non-collection character fields. Preserve existing
    `characterOrder` and selected-character behavior. Do not move
    character assets, emotion images, additional asset references,
    lorebooks, scripts, module membership, or chat transcript changes
    here.
  - **9-3b — Chat records, folders, and metadata.** Move chat
    create/delete/rename/reorder/select, chat folder create/delete/
    rename/reorder, folder assignment, chat notes, `fmIndex`,
    `bindedPersona`, bookmark names, and other chat-level metadata.
    Preserve current index-to-id behavior until 9-0 locks the command
    map. Do not move message body edits or generation writes here.
  - **9-3c — Message history commands.** Move explicit user-visible
    transcript mutations: append/manual insert, edit, delete,
    truncate, disable/all-before toggles, role changes, bookmark/fork
    metadata, and prompt/generation info patches that are edited from
    the message UI. Keep streaming, regenerate/continue, trigger
    effects, memory summaries, and cold-storage materialization out of
    this slice.
  - **9-3d — Generation persistence handoff.** Scope re-check on
    2026-05-24 against `src/ts/process/postGeneration/streamResponse.ts`
    (rows 59, 69-70, 108-110, 119-120),
    `postGeneration/nonStreamResponse.ts` (105, 113, 123),
    `postGeneration/orchestrateResponse.ts` (114, 153, 163), and
    `postGeneration/stage4Finalize.ts` (34) found four distinct
    mutation kinds with independent rollback boundaries (message
    append/edit vs. streaming-state toggles vs. reroll bookkeeping vs.
    `generationInfo` patch). The send / continue / regenerate functions
    share `sendChat` re-entry — they differ in _which_ messages mutate
    and _when_ rerolls are collected, not in separate code paths. Land
    in order:
    - **9-3d-i — Message-row writes.** `message.push` (both branches)
      - the streaming chunk `data` rewrites + the non-streaming final
        replacement. Send / continue / regenerate all flow through this
        one row-write surface; the streaming-vs-non-streaming branch
        decides the patch shape, not the resource.
    - **9-3d-ii — Streaming state.** `isStreaming` toggles +
      `reloadKeys` bumps. Distinct because they drive UI rendering and
      need a separate "stream open / close" command pair the projection
      can debounce.
    - **9-3d-iii — Reroll/unreroll + post-generation patch.**
      `addRerolls` storage from `orchestrateResponse`, trigger
      chat-effect replacement, and the `stage4Finalize` `generationInfo`
      patch. Rerolls are append-only history mutations; the post-gen
      patch is metadata-only. Both are post-stream, so they can land
      after dispatch finalizes.

    Preserve Phase 7 chat-generation fixture parity across all three —
    each sub-slice re-runs the full sendChat fixture suite. Treat the
    union of (i + ii + iii) as the rollback boundary for generation UI
    behavior.

  - **9-3e — Chat `scriptstate` and scripting side effects.** Move
    `scriptstate` commands for parser chat variables, command
    `setvar`/`addvar`, and Phase 7-surviving trigger effects that
    append, cut, or modify messages at runtime. Trigger definition
    editing stays in 9-4; this slice only owns the chat-state writes
    produced while scripts run.
  - **9-3f — Compatibility setters and access adapters.** Replace
    helper/API mutation bypasses such as `setCurrentCharacter`,
    `setCharacterByIndex`, `setCurrentChat`, plugin API character/chat
    setters, and MCP-facing character/chat write adapters with typed
    command calls or explicit server-backed no-op/unsupported behavior.
    Keep plugin-defined resources out of scope and require 9-0 to
    classify any Tauri/local-only compatibility path before changing it.

- **9-4 — Lorebooks, modules, plugins, assets.** Umbrella milestone
  for child collections, extension surfaces, and resource-heavy
  commands. Do not pick this up as one implementation slice: lorebook
  collections, script/trigger definitions, modules, plugin state,
  plugin-storage kv, and asset references have different client call
  sites and rollback risks. Keep plugin-defined resources out of
  scope. Close the sub-slices below in order.
  - **9-4a — Lorebook collection commands.** Move global lorebook
    records, character `globalLore`, chat `localLore`, and module
    `lorebook` edits behind typed commands. Cover create/update/
    delete, folder entries, reorder/folder moves, import/export
    handoff, and MCP-facing lorebook adapters. Preserve existing
    id-vs-index behavior until 9-0 locks the command map, and keep
    runtime trigger effects that mutate lorebooks out of this slice
    unless 9-0 explicitly assigns them here.
  - **9-4b — Script and trigger definition commands.** Move
    character `customscript`/`triggerscript` and module `regex`/
    `trigger` definition editing, import/export, reorder, and bulk
    replacement flows. This slice owns definitions only; runtime
    writes produced while scripts/triggers run stay in 9-3e.
  - **9-4c — Module records and enablement.** Move module create,
    import, edit, delete, export metadata, scalar module fields,
    `enabledModules`, active-module selection helpers, and
    `moduleUpdate` compatibility paths. Defer apply-module behavior
    until 9-4a and 9-4b commands exist, then implement it as a
    composite command or an explicit sequence of existing child
    collection commands.
  - **9-4d — Asset reference commands.** Move character emotion
    images, character additional assets, prebuilt asset include/
    exclude fields, module assets, and asset-name edits behind typed
    commands. Reuse the existing content-addressed asset upload route
    for bytes; this slice only owns database references to uploaded
    assets. Bundle walking and `.risu` multipart import/export stay in
    9-8.
  - **9-4e — Plugin records and configuration.** Move plugin install,
    enable/disable, remove, provider selection, `realArg` updates, and
    plugin config UI writes behind typed commands. Preserve the
    existing plugin loading behavior and do not add plugin-defined data
    resources.
  - **9-4f — Plugin-storage kv and plugin database adapters.** Move
    `pluginCustomStorage`, plugin `pluginStorage`, safe DB proxy
    custom-property writes, and plugin-exposed `setDatabase`/
    `setDatabaseLite` writes to commands or explicit server-backed
    unsupported/no-op behavior. **Architecture decision lives in 9-0c,
    not here.** Scope re-check on 2026-05-24 against
    `src/ts/plugins/plugins.svelte.ts:37-61, 763-793` and
    `src/ts/plugins/apiV3/risuai.d.ts:1406, 1412` found that
    `setDatabase`/`setDatabaseLite` filter writes through a 26-entry
    `allowedDbKeys` whitelist (`characters`, `modules`, `personas`,
    `plugins`, `pluginCustomStorage`, etc.) and silently route unknown
    keys to `pluginCustomStorage`. This is **field-level** mutation
    that escapes any resource-level command map. 9-0c must lock one of:
    (a) plugins call typed commands directly; (b) a translation bridge
    converts plugin writes into command calls and rejects unmappable
    fields; (c) only `pluginCustomStorage` survives and the 25 other
    whitelisted keys become hard rejections. 9-4f then implements the
    locked choice. **Do not start 9-4f until the 9-0c readiness
    checklist (9-0d) lists this decision as resolved.**
  - **9-4g — Compatibility sweep and focused tests.** Verify the 9-4
    families have no remaining direct `DBState.db` writes in
    server-backed web paths, excluding test-only, Tauri/local-only,
    transient, or obsolete sites documented by 9-0. Add focused command
    tests for revision conflicts, child collection replacement,
    plugin-storage kv, and asset-reference persistence before 9-5
    turns on read-only projection enforcement.
- **9-5 — Browser projection.** Umbrella milestone for turning the
  web client into a projection of server state. Do not pick this up as
  one implementation slice: the events route, startup bootstrap,
  event-driven re-fetching, residual command replacements, and
  read-only guard are separate rollback boundaries. Close the
  sub-slices below in order.
  - **9-5a — Events endpoint.** Add `/api/v1/events` as a
    **persistent** server-backed browser event stream — not the
    per-request SSE pattern Phase 7's `/chat` route uses. Scope
    re-check on 2026-05-24 against
    `server/fastify/src/routes/generationChat.ts:169-174` and the
    `prompt/sseEvents.ts` writer found no existing connection
    registry, broadcaster, or event bus — `/chat` writes SSE headers
    once per request and emits inline. 9-5a has to build the
    persistent-connection infrastructure from scratch: connection
    registry tracking active subscribers, an event broadcaster that
    fans command-emission events out to every connected client,
    heartbeat/keepalive (proxies and browsers drop idle SSE
    connections), connection lifecycle cleanup on drop, and
    auth/session handling. Tests prove an existing successful command
    emits an observable event to a connected client. **Do not wire the
    browser projection client in this slice.**
  - **9-5b — Bootstrap projection loader.** Add
    `src/ts/server/bootstrap.ts` to load `/api/v1/bootstrap` on app
    start and switch the web startup hydration path through that
    helper. Keep live event subscription, read-only enforcement, and
    storage/provider-key gating out of this slice.
  - **9-5c — Event subscription and debounced re-bootstrap.** Add
    `src/ts/server/events.ts` and wire it so server events trigger a
    debounced `/api/v1/bootstrap` re-fetch. Preserve the Phase 9
    boundary that event payloads do not surgically patch client state;
    the client rehydrates from bootstrap until a later optimization
    phase explicitly changes that.
  - **9-5d — Residual command replacement sweep.** Replace any
    remaining server-backed web mutation paths that were assigned to
    9-2 through 9-4 but could not be switched until projection helpers
    existed. Treat large newly discovered mutation families as leakage
    from the earlier command slices and move them back to the owning
    9-2, 9-3, or 9-4 sub-slice instead of widening 9-5.
  - **9-5e — Read-only `DBState.db` guard.** Turn on the
    server-backed read-only guard after the 9-4g compatibility sweep,
    9-5d residual sweep, and focused command tests are green. The guard
    should fail loudly for direct mutation attempts in web mode while
    leaving Tauri/local mode untouched.
- **9-6 — Storage and provider-key gating.** Umbrella milestone for
  removing browser-owned persistence from server-backed web mode and
  masking provider keys once the server can stand on its own. Do not
  pick this up as one implementation slice: asset helpers, save/backup
  bridges, import entrypoints, miscellaneous localForage users, and key
  masking have different rollback risks. Close the sub-slices below in
  order.
  - **9-6a — Storage/localForage audit closeout.** Re-run a focused
    storage audit after 9-5e: `localforage.createInstance`,
    `forageStorage.*`, `AutoStorage`, `NodeStorage`, `OpfsStorage`,
    `realStorage`, service-worker asset cache paths, and plugin-exposed
    storage helpers. Classify each remaining site as server-backed
    persistence, server-backed transient/cache, Tauri/local-only,
    plugin-owned, obsolete, or already blocked by earlier 9-2 through
    9-5 slices. Do not change behavior here; publish the final storage
    checklist before touching gates.
  - **9-6b — Asset helper server routing.** In Fastify mode, move
    `getFileSrc`, `readImage`, `saveAsset`, and `loadAsset` in
    `globalApi.svelte.ts` to the content-addressed `/api/v1/assets`
    routes and the `assetBaseUrl` from bootstrap. Preserve Tauri's
    AppData file behavior and any still-gated local-only fallback that
    9-6a explicitly classifies. Do not change character/module import
    command behavior here except where those flows call the asset
    helpers for bytes.
  - **9-6c — Save, backup, and `AutoStorage` bridge shutdown.** Stop
    server-backed web startup, save, backup, restore, and cleanup paths
    from reaching `forageStorage`, `AutoStorage`, OPFS, localForage, or
    the legacy NodeStorage key-value bridge. Gate `saveDb`,
    `getDbBackups`, `loadInternalBackup`, bootstrap local-save loading,
    and asset cleanup behind the server/Tauri mode split, using server
    command/bootstrap/backup routes in Fastify mode. Leave Tauri/local
    storage untouched.
  - **9-6d — Character-card and file import entrypoints.** Move
    Fastify-mode character-card, preset, module, shared-file,
    URL/hash import, and PWA `launchQueue` entrypoints onto the
    commands/routes assigned by 9-0 through 9-4. Fastify mode must not
    mutate `DBState.db` directly or depend on client-side `.risu`
    encode/decode. Preserve Tauri deep-link and local import/export
    behavior on the local storage path. Defer full `.risu` save
    import/export and bundle walking to 9-7 and 9-8.
  - **9-6e — Miscellaneous localForage consumers.** Resolve every
    remaining non-asset localForage consumer from the 9-6a checklist:
    translator cache, Iris/local UI scratch data, plugin permission
    storage, plugin custom storage adapters, inlay caches, MCP
    credentials, memory/embedding caches, and cold-storage helpers.
    For each one, choose an explicit Fastify-mode behavior: server
    route/command, in-memory session cache, unsupported/no-op with a
    visible error, or Tauri/local-only gate. Do not create new plugin
    resource families in this slice.
  - **9-6f — Provider-key masking readiness and flip.** Add bootstrap
    key masking support and tests, then flip `RISU_MASK_SERVER_KEYS=1`
    only after the server-backed provider matrix still works without
    client-visible provider secrets. Cover `/api/v1/bootstrap`,
    `/api/v1/generate/completion`, `/api/v1/generate/chat`, dynamic
    model-list fetches, translator keys, reverse-proxy/custom-provider
    keys, Vertex/Bedrock credentials, and plugin provider behavior.
    Treat any provider that still needs a browser-visible secret as a
    blocker, not as a reason to widen this slice.
- **9-7 — Server `.risu` codec core.** Umbrella milestone for moving
  the `.risu` format core onto the server. Do not pick this up as one
  implementation slice: legacy msgpack envelopes, RISUSAVE block
  containers, import normalization, repository-backed export assembly,
  and unsupported remote/cache behavior have different failure modes.
  Keep HTTP routes, multipart import, ZIP bundle generation, and asset
  reference walking in 9-8. Close the sub-slices below in order.
  - **9-7a — Codec fixture and contract gate.** Build a fixture corpus
    against the current client `src/ts/storage/risuSave.ts`: legacy raw,
    legacy compressed, stream-compressed legacy, RISUSAVE block save,
    per-block gzip, root component blocks, missing/corrupt blocks, and
    remote/cache directory entries. Record expected decoded Database
    shape plus header, block directory, and error behavior. Do not write
    server codec production code here.
  - **9-7b — Legacy envelope codec.** Port the magic headers,
    `encodeRisuSaveLegacy`, stream-compressed encode, and
    `decodeRisuSave` support for raw, compressed, stream-compressed, and
    legacy fallback envelopes using server-safe Node APIs. Do not parse
    RISUSAVE blocks, touch repositories, or wire routes in this slice.
  - **9-7c — RISUSAVE block container codec.** Implement block
    reader/writer support for `RisuSaveType`, block names, lengths,
    directory entries, root/root-component blocks, character blocks, bot
    presets, modules, loadouts, plugins, plugin storage, per-block gzip,
    and deterministic block order. Drop localforage cache lookup and
    Tauri remote-file branches; represent `REMOTE` blocks as explicit
    unsupported or missing-block results instead of reading local client
    storage.
  - **9-7d — Decode normalization and validation.** Convert decoded
    envelopes/blocks into the import-ready database/resource payload
    shape Phase 9 expects. Preserve the legacy bot-preset fallback, and
    surface structured errors for corrupt roots, invalid JSON, missing
    required directory blocks, and unsupported `REMOTE` content. Leave
    the Phase 2 JSON-only import route behavior unchanged.
  - **9-7e — Repository-backed export adapter.** Define the narrow
    repository snapshot interface the codec needs, then assemble
    legacy-compatible root, character, preset, module, loadout, plugin,
    and plugin-storage blocks from the Phase 9 per-resource
    repositories. Keep asset byte collection, bundle manifests, and
    route response headers out of scope. **Hard dependency
    (2026-05-24):** the per-resource repositories this slice reads from
    do not exist until 9-2 (presets, personas, loadouts), 9-3
    (characters), and 9-4a/c/e/f (modules, plugins, plugin-storage)
    close. **9-7e is blocked on 9-2 + 9-3 + 9-4a/c/e/f.** 9-7a–d can
    land earlier in parallel because they don't read from the
    repositories.
  - **9-7f — Round-trip parity and closeout.** Add focused server tests
    that decode the fixture corpus, encode representative repository
    snapshots, and verify client/server parity where the client codec can
    still decode the result. Prove the server codec does not import
    `localforage`, Tauri APIs, or `globalApi.svelte.ts`, and document any
    intentionally unsupported legacy cache/remote cases before 9-8
    starts.
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
