# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-4c landed module record and enablement commands. It added Fastify
commands and browser helpers for module create, patch, delete,
enablement, global module reorder, and character module-link reorder;
routed server-backed web module settings, normal module imports, loadout
module enablement, chat active-module toggles, character module links, and
MCP module info/enablement writes through command helpers; rejected MCP
module rows from normal module record commands; and kept module
lorebooks/scripts/triggers on their existing replacement commands.

## Immediate Pickup

Continue Phase 9 implementation with
**9-4d - Asset reference commands**.

Expected scope:

- Add durable asset reference command coverage for fields that point at
  already uploaded server assets.
- Route server-backed web asset reference writes through the owning
  resource commands instead of direct `DBState.db` mutations.
- Keep asset bytes on the existing `POST /api/v1/assets` upload path.
- Validate that referenced server asset ids exist where the owning field
  expects a server asset.
- Keep bundle walking and full `.risu` import/export for 9-8.
- Preserve existing 9-1 command contract: `baseRevision`, 409 conflict,
  single mutation/revision/event on success, no revision bump on failure,
  and rollback from browser dispatch helpers.

Out of scope for 9-4d:

- Settings groups, bot presets, prompt templates/items, personas,
  translator presets, loadouts, character catalog/profile commands, chat
  record/folder metadata commands, message commands, generation
  persistence, scriptstate, lorebook commands, script/trigger definition
  commands, module record/enablement commands, and compatibility setters
  already covered by prior slices.
- Asset byte upload/storage changes beyond existing Fastify asset APIs.
- Plugin records/config/storage bridge; keep them in 9-4e/9-4f.
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
- Character scalar profile patches reject child collections and asset
  reference fields owned by later slices.
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
  unsupported errors in Fastify mode. 9-4a replaced lorebook writes and
  9-4b replaced script/trigger writes; keep asset writes unsupported until
  9-4d.
- 9-4a added `src/ts/server/lorebookBridge.svelte.ts` as a debounced
  whole-collection replacement bridge for bound lorebook UI surfaces.
- 9-4b added `src/ts/server/scriptDefinitionBridge.svelte.ts` as a
  debounced whole-collection replacement bridge for bound script/trigger
  UI surfaces.
- 9-4c added `src/ts/moduleCommands.ts` for module record dispatch and
  rollback. Chat active-module toggles use the existing chat metadata
  command with the `modules` field; character module links use
  `POST /api/v1/commands/characters/:characterId/modules/reorder`.
- MCP module import is explicitly unsupported in server-backed web mode
  until a later slice defines a dedicated server-owned path.

## Later Queue

1. 9-4e - Plugin records and configuration.
2. 9-4f - Plugin-storage kv and plugin database adapters.
3. 9-4g - Compatibility sweep and focused tests.
4. 9-5 - Browser projection.
5. 9-6 - Storage and provider-key gating.
6. 9-7 - Server `.risu` codec core.
7. 9-8 - Import/export routes and bundle assets.
8. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/adapter tests while building 9-4d, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-4c:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 692 tests passed, 4 skipped.
- `pnpm api:test` - 1107 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

Focused 9-4c runs:

- `pnpm api:test -- commands.test.ts` - 1107 tests passed.
- `pnpm test -- src/ts/server/commands.test.ts src/ts/compatibilityAdapters.test.ts` -
  692 tests passed, 4 skipped.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-4c.md`](../phases-completed/phase-9-client-thinning-9-4c.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
