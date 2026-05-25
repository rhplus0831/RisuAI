# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-4a landed lorebook collection commands. It added Fastify command
endpoints and browser helpers for global lorebooks plus global,
character, chat, and module lorebook entry replacement; normalized
lorebook and entry ids in the current schema; routed lorebook UI and MCP
character/module lorebook writes through command helpers in Fastify mode;
and kept script/trigger, module lifecycle, asset, plugin, and storage
bridge work deferred to their owning slices.

## Immediate Pickup

Continue Phase 9 implementation with
**9-4b - Script and trigger definition commands**.

Expected scope:

- Add script and trigger definition commands from the locked command map:
  character scripts, character triggers, module scripts, and module
  triggers.
- Use whole-child replacement semantics for definition arrays and keep
  runtime trigger side effects on the existing 9-3e scriptstate command.
- Route server-backed web script and trigger definition writes away from
  mutable `DBState.db` paths and through typed command helpers.
- Replace the remaining 9-3f MCP unsupported behavior for character
  regex/Lua script writes with 9-4b commands, and add module MCP
  script/trigger coverage where writes currently mutate modules directly.
- Preserve existing 9-1 command contract: `baseRevision`, 409 conflict,
  single mutation/revision/event on success, no revision bump on failure,
  and rollback from browser dispatch helpers.

Out of scope for 9-4b:

- Settings groups, bot presets, prompt templates/items, personas,
  translator presets, loadouts, character catalog/profile commands, chat
  record/folder metadata commands, message commands, generation
  persistence, scriptstate, lorebook commands, and compatibility setters
  already covered by prior slices.
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
  unsupported errors in Fastify mode. 9-4a replaced lorebook writes; keep
  asset writes unsupported until 9-4d and replace script/trigger writes in
  9-4b.
- 9-4a added `src/ts/server/lorebookBridge.svelte.ts` as a debounced
  whole-collection replacement bridge for bound lorebook UI surfaces.
  Script/trigger UI can follow the same pattern if direct Svelte binds are
  too broad to replace surgically in one slice.

## Later Queue

1. 9-4c - Module records and enablement.
2. 9-4d - Asset reference commands.
3. 9-4e - Plugin records and configuration.
4. 9-4f - Plugin-storage kv and plugin database adapters.
5. 9-4g - Compatibility sweep and focused tests.
6. 9-5 - Browser projection.
7. 9-6 - Storage and provider-key gating.
8. 9-7 - Server `.risu` codec core.
9. 9-8 - Import/export routes and bundle assets.
10. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/adapter tests while building 9-4b, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-4a:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 687 tests passed, 4 skipped.
- `pnpm api:test` - 1101 tests passed.
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
  [`../phases-completed/phase-9-client-thinning-9-4a.md`](../phases-completed/phase-9-client-thinning-9-4a.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
