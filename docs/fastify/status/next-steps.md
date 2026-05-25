# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-5b landed the browser bootstrap projection loader. Fastify-served web
startup now reads authenticated `GET /api/v1/bootstrap`, applies the
returned database projection through the existing normalization path, and
caches the returned revision for command helpers. Tauri/local web startup
continues to use the existing local storage path.

## Immediate Pickup

Continue Phase 9 implementation with **9-5c - Event subscription and
debounced re-bootstrap**.

Expected scope:

- Add a browser-side event helper, likely under `src/ts/server/events.ts`,
  for authenticated `GET /api/v1/events` SSE reads in Fastify
  server-backed web mode.
- Wire Fastify-served browser startup after the initial bootstrap load to
  subscribe to command events.
- On command events, debounce a `/api/v1/bootstrap` re-fetch and replace
  the browser projection with the returned database.
- Cache the refreshed revision via `setCachedServerCommandRevision`.
- Keep per-event surgical patching out of scope; every command event
  invalidates through the debounced bootstrap projection.
- Preserve Tauri/local web storage behavior outside Fastify mode.
- Add focused event helper/startup tests that prove command events trigger
  one debounced re-bootstrap and that non-Fastify mode does not subscribe.

Out of scope for 9-5c:

- Enforcing a read-only `DBState.db` guard.
- Residual command replacement sweep.
- Storage/provider-key gating.
- Server-side `.risu` import/export implementation.
- Asset byte upload/storage changes beyond existing Fastify asset APIs.
- Plugin code execution server-side.

Implementation notes:

- Phase 9 is not a single "add commands" task. Treat command foundation,
  browser projection, storage gating, provider-key masking, and the
  server `.risu` codec as separate rollback surfaces.
- Build on the foundation in `server/fastify/src/commands/`,
  `server/fastify/src/routes/commands.ts`, and
  `src/ts/server/commands.ts`.
- Use the locked command map in
  [`phase-9-command-map.md`](phase-9-command-map.md) as the source of
  truth for command names, payload behavior, event names, and plugin
  bridge policy.
- Debounced re-bootstrap is the Phase 9 projection target. Per-event
  surgical patches are future work.
- Tauri keeps its local storage path. Phase 9 gates server-backed web
  behavior without changing local desktop storage mode.
- Character scalar profile patches reject child collections, but 9-4d now
  owns character asset-reference fields (`image`, `emotionImages`,
  `additionalAssets`, `ccAssets`, and `prebuiltAssetExclude`).
- Chat metadata patches reject fields owned by later slices:
  `message`, `localLore`, `scriptstate`, generation/runtime fields, and
  child collections except the 9-4c-owned `modules` active-module field.
  Use message, generation, or scriptstate commands instead.
- Message patch commands now reject `generationInfo`; keep durable
  generation metadata on the 9-3d generation persistence command.
- Generation persistence command accepts a finalized assistant message
  snapshot and optional `targetMessageId` for continue-style replacement;
  do not use it for scriptstate.
- Message rows preserve existing `message.chatId` as the public message id.
  The 9-3c helpers normalize missing or duplicate ids during message
  command mutations.
- 9-3f made lorebook/script/asset MCP child writes return explicit
  unsupported errors in Fastify mode. 9-4a replaced lorebook writes,
  9-4b replaced script/trigger writes, and 9-4d replaced regular asset
  reference writes; MCP asset import still needs a dedicated server-owned
  path in a later slice.
- 9-4a added `src/ts/server/lorebookBridge.svelte.ts` as a debounced
  whole-collection replacement bridge for bound lorebook UI surfaces.
- 9-4b added `src/ts/server/scriptDefinitionBridge.svelte.ts` as a
  debounced whole-collection replacement bridge for bound script/trigger
  UI surfaces.
- 9-4c added `src/ts/moduleCommands.ts` for module record dispatch and
  rollback. Chat active-module toggles use the existing chat metadata
  command with the `modules` field; character module links use
  `POST /api/v1/commands/characters/:characterId/modules/reorder`.
- 9-4d made Fastify-mode `saveAsset` return raw server asset ids, not
  `assets/<id>.<ext>` paths. Tauri/local storage keeps the old asset path
  shape. Server validators reject missing or malformed server asset ids
  for fields that expect uploaded server assets.
- 9-4e added `src/ts/pluginCommands.ts` for plugin record/config
  dispatch and rollback. Plugin `name` is the command id and is not
  renameable through plugin patch commands. Provider selection stores the
  provider string as-is because plugin-registered provider names do not
  always equal plugin record names.
- 9-4f added plugin-storage put/delete/bulk commands and extended
  `src/ts/pluginCommands.ts` for plugin custom storage rollback. Fastify
  mode `pluginStorage.*`, plugin database proxy writes, `setDatabaseLite`,
  and `setDatabase` dispatch command-backed translation for plugin
  storage, plugin records/provider, and scalar settings; unknown top-level
  plugin DB keys are stored in `pluginCustomStorage`.
- 9-4g tightened the plugin database bridge so `currentPluginProvider`,
  `modules`, and `enabledModules` translate through existing provider and
  module commands in Fastify mode. This did not add new command endpoints.
- 9-5a added `GET /api/v1/events` as an auth-gated SSE route over the
  command event sink. It intentionally does not add browser subscription
  code; 9-5c owns debounced re-bootstrap on events.
- 9-5b added `src/ts/server/bootstrap.ts` and `loadWebInitialDatabase()`.
  Fastify mode reads `/api/v1/bootstrap`, sets `DBState.db`, and caches
  the revision. It intentionally does not add event subscription,
  read-only guards, or storage/save-loop gating.
- MCP module import is explicitly unsupported in server-backed web mode
  until a later slice defines a dedicated server-owned path.

## Later Queue

1. 9-5c - Event subscription and debounced re-bootstrap.
2. 9-5d - Residual command replacement sweep.
3. 9-5e - Read-only `DBState.db` guard.
4. 9-6 - Storage and provider-key gating.
5. 9-7 - Server `.risu` codec core.
6. 9-8 - Import/export routes and bundle assets.
7. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused browser event/re-bootstrap tests while building 9-5c, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-5b:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 702 tests passed, 4 skipped.
- `pnpm api:test` - 1119 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

Focused 9-5a run:

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/events.test.ts`
  - 4 tests passed.

Focused 9-5b run:

- `pnpm exec vitest run src/ts/server/bootstrap.test.ts src/ts/bootstrap.test.ts`
  - 5 tests passed.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-5b.md`](../phases-completed/phase-9-client-thinning-9-5b.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
