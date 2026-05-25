# Next Steps

Date: 2026-05-26

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-4f landed plugin-storage kv and plugin database adapter coverage. It
added Fastify commands for plugin custom storage put/delete/bulk updates,
typed browser helpers, plugin-storage rollback helpers in
`src/ts/pluginCommands.ts`, and routed Fastify-mode `pluginStorage.*`,
plugin database proxy writes, `setDatabaseLite`, and `setDatabase`
through command-backed translation. Plugin code execution remains
browser-side.

## Immediate Pickup

Continue Phase 9 implementation with
**9-4g - Compatibility sweep and focused tests**.

Expected scope:

- Sweep the 9-4 resource families for residual direct server-backed web
  writes: lorebooks, scripts/triggers, modules, asset references, plugins,
  plugin storage, and plugin database adapters.
- Add focused compatibility tests for any remaining adapter paths found by
  the sweep.
- Confirm plugin database setter translation does not reintroduce
  whole-DB replacement in Fastify mode.
- Keep fixes narrowly within already-commanded 9-4 families; do not start
  9-5 projection/event/bootstrap enforcement.
- Update the command-map or active phase docs only if the sweep finds an
  implementation boundary that future slices must know about.

Out of scope for 9-4g:

- Settings groups, bot presets, prompt templates/items, personas,
  translator presets, loadouts, character catalog/profile commands, chat
  record/folder metadata commands, message commands, generation
  persistence, scriptstate, lorebook commands, script/trigger definition
  commands, module record/enablement commands, asset reference commands,
  plugin record/configuration commands, and compatibility setters already
  covered by prior slices.
- Asset byte upload/storage changes beyond existing Fastify asset APIs.
- Plugin code execution server-side.
- Enforcing a read-only `DBState.db` guard.
- Bootstrap/event projection implementation.
- Server-side `.risu` import/export implementation.
- Provider-key masking or storage backend removal.

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
  and `setDatabase` now dispatch command-backed translation for plugin
  storage, plugin records/provider, and scalar settings; unknown top-level
  plugin DB keys are stored in `pluginCustomStorage`.
- MCP module import is explicitly unsupported in server-backed web mode
  until a later slice defines a dedicated server-owned path.

## Later Queue

1. 9-5 - Browser projection.
2. 9-6 - Storage and provider-key gating.
3. 9-7 - Server `.risu` codec core.
4. 9-8 - Import/export routes and bundle assets.
5. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/adapter tests while building 9-4g, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-4f:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 694 tests passed, 4 skipped.
- `pnpm api:test` - 1115 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

Focused 9-4f runs:

- `pnpm api:test -- commands.test.ts` - 1115 tests passed.
- `pnpm test -- src/ts/server/commands.test.ts` - 694 tests passed, 4 skipped.
- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-4f.md`](../phases-completed/phase-9-client-thinning-9-4f.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
