# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-3e landed chat `scriptstate` command coverage. It added
`PATCH /api/v1/commands/chats/:chatId/scriptstate`, the
`chat.scriptstate.updated` event, typed browser helpers, command-backed
server `message_patch` chat-var replay, and Fastify-mode dispatch for
CBS/chat-var, trigger `setVar`, and slash `/setvar` / `/addvar` writes.
The older `/api/v1/generate/chat` direct `applyImport` persistence path
for chat-var writes was removed; durable scriptstate persistence is now
owned by commands.

## Immediate Pickup

Continue Phase 9 implementation with
**9-3f - Compatibility setters and access adapters**.

Expected scope:

- Replace compatibility setters and mutable access adapters assigned to
  9-3f with existing commands or explicit unsupported behavior in
  server-backed web mode.
- Cover `setCurrentCharacter`, `setCurrentChat`, mutable
  `getDatabase()`-style character/chat write helpers, CBS/MCP access
  surfaces, and plugin/MCP character/chat writes called out by
  `phase-9-command-map.md`.
- Use already-landed character, chat, message, generation, and
  scriptstate commands; do not add a new endpoint family for 9-3f.
- Keep generic message append/update/delete/truncate/replace on the 9-3c
  commands.
- Keep generation result persistence on the 9-3d command.
- Keep scriptstate persistence on the 9-3e command.
- Keep chat record/folder metadata on the 9-3b commands.
- Do not reopen settings groups, bot presets, prompt templates/items,
  personas, translator presets, loadouts, or character scalar/catalog
  commands in this slice.
- Preserve the 9-1 command contract by routing through existing command
  helpers rather than mutating `DBState.db` directly in Fastify mode.
- Cover representative compatibility writes, explicit unsupported paths,
  rollback where command dispatch fails, and no command dispatch outside
  Fastify mode.

Out of scope for 9-3f:

- Settings groups, bot presets, prompt templates/items, personas,
  translator presets, loadouts, character catalog/profile commands, and
  chat record/folder metadata commands.
- Generic message history commands; they landed in 9-3c.
- Generation persistence; it landed in 9-3d.
- Chat `scriptstate`; it landed in 9-3e.
- Lorebook/script/trigger child collections and asset bytes/references;
  keep them in 9-4.
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
- Character scalar profile patches now reject child collections and asset
  reference fields owned by later slices. Do not loosen that in 9-3f.
- Chat metadata patches now reject fields owned by later slices:
  `message`, `localLore`, `scriptstate`, generation/runtime fields, and
  child collections. Do not loosen that in 9-3f; use message,
  generation, or scriptstate commands instead.
- Message patch commands now reject `generationInfo`; keep durable
  generation metadata on the 9-3d generation persistence command.
- Generation persistence command accepts a finalized assistant message
  snapshot and optional `targetMessageId` for continue-style replacement;
  do not use it for scriptstate.
- Message rows preserve existing `message.chatId` as the public message id.
  The 9-3c helpers normalize missing or duplicate ids during message
  command mutations.
- Chat scriptstate commands accept partial `{ patch }` values plus
  optional `deleteKeys`; values are limited to string, number, or boolean.
  Do not widen scriptstate commands to accept message rows, prompt info,
  generation metadata, or script/trigger definitions.

## Later Queue

1. 9-4 - Lorebooks, modules, plugins, assets.
2. 9-5 - Browser projection.
3. 9-6 - Storage and provider-key gating.
4. 9-7 - Server `.risu` codec core.
5. 9-8 - Import/export routes and bundle assets.
6. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/adapter tests while building 9-3f, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-3e:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 682 tests passed, 4 skipped.
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
  [`../phases-completed/phase-9-client-thinning-9-3e.md`](../phases-completed/phase-9-client-thinning-9-3e.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
