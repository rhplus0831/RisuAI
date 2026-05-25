# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-3f landed compatibility setters and access adapters. It added shared
character/chat compatibility diff dispatchers, routed `setCurrentCharacter`,
`setCharacterByIndex`, `setCurrentChat`, slash message-history commands,
plugin V3 character/chat index setters, and MCP scalar character edits
through existing 9-3 commands in Fastify mode, and made MCP lorebook,
script, trigger, and asset writes explicitly unsupported until 9-4.

## Immediate Pickup

Continue Phase 9 implementation with
**9-4a - Lorebook collection commands**.

Expected scope:

- Add lorebook collection commands from the locked command map:
  global lorebooks, character lorebooks, chat lorebooks, module lorebooks,
  entry replacement, and reorder/delete behavior where currently exposed.
- Give lorebook rows stable ids in the current schema as needed before
  command addressing; this is a current-shape update, not a compatibility
  migration.
- Route server-backed web lorebook writes away from mutable
  `DBState.db` paths and through typed command helpers.
- Cover existing UI and compatibility surfaces that edit lorebooks,
  including MCP character lorebook writes that 9-3f now rejects in
  Fastify mode.
- Preserve existing 9-1 command contract: `baseRevision`, 409 conflict,
  single mutation/revision/event on success, no revision bump on failure,
  and rollback from browser dispatch helpers.

Out of scope for 9-4a:

- Settings groups, bot presets, prompt templates/items, personas,
  translator presets, loadouts, character catalog/profile commands, chat
  record/folder metadata commands, message commands, generation
  persistence, scriptstate, and compatibility setters.
- Script and trigger definition commands; keep them in 9-4b.
- Module lifecycle/enablement commands; keep them in 9-4c.
- Asset bytes/references; keep them in 9-4d.
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
  child collections. Use message, generation, or scriptstate commands
  instead.
- Message patch commands now reject `generationInfo`; keep durable
  generation metadata on the 9-3d generation persistence command.
- Generation persistence command accepts a finalized assistant message
  snapshot and optional `targetMessageId` for continue-style replacement;
  do not use it for scriptstate.
- Message rows preserve existing `message.chatId` as the public message id.
  The 9-3c helpers normalize missing or duplicate ids during message
  command mutations.
- 9-3f made lorebook/script/asset MCP child writes return explicit
  unsupported errors in Fastify mode. Replace the lorebook part of that
  behavior in 9-4a, but keep script/trigger and asset writes unsupported
  until their owning slices land.

## Later Queue

1. 9-4b - Script and trigger definition commands.
2. 9-4c - Module records and enablement.
3. 9-4d - Asset reference commands.
4. 9-4e - Plugin records and configuration.
5. 9-4f - Plugin-storage kv and plugin database adapters.
6. 9-4g - Compatibility sweep and focused tests.
7. 9-5 - Browser projection.
8. 9-6 - Storage and provider-key gating.
9. 9-7 - Server `.risu` codec core.
10. 9-8 - Import/export routes and bundle assets.
11. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/adapter tests while building 9-4a, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-3f:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 686 tests passed, 4 skipped.
- `pnpm api:test` - 1097 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## References

- Active phase:
  [`../phases/phase-9-client-thinning.md`](../phases/phase-9-client-thinning.md)
- Command map:
  [`phase-9-command-map.md`](phase-9-command-map.md)
- Closed memory phase:
  [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-9-client-thinning-9-3f.md`](../phases-completed/phase-9-client-thinning-9-3f.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
