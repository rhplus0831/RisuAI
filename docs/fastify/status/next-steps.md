# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-3d landed generation persistence handoff. It added
`POST /api/v1/commands/chats/:chatId/generation-result`, the
`generation.persisted` event, typed browser helpers, and server-backed
`sendChat` dispatch for finalized assistant message snapshots after
terminal generation metadata and stage-4 closeout.

## Immediate Pickup

Continue Phase 9 implementation with
**9-3e - Chat `scriptstate` and scripting side effects**.

Expected scope:

- Add chat scriptstate command coverage according to
  `phase-9-command-map.md`:
  `PATCH /api/v1/commands/chats/:chatId/scriptstate`.
- Persist runtime script variable and chat-state writes in server-backed
  web mode through the scriptstate command.
- Support partial scriptstate patches plus optional delete keys.
- Replace durable script-trigger/CBS chat-state writes assigned to 9-3e
  with command dispatch where Fastify mode is active.
- Keep generic message append/update/delete/truncate/replace on the 9-3c
  commands. Do not widen message patch commands to accept generation
  persistence fields as ad hoc updates.
- Keep generation result persistence on the 9-3d command. Do not widen
  scriptstate commands to accept message rows, prompt info, or generation
  metadata.
- Keep chat record/folder metadata on the 9-3b commands. Do not widen
  `PATCH /api/v1/commands/chats/:chatId` to accept `message`,
  `localLore`, `scriptstate`, or generation persistence.
- Do not reopen settings groups, bot presets, prompt templates/items,
  personas, translator presets, loadouts, or character scalar/catalog
  commands in this slice.
- Preserve the 9-1 command contract: every command takes
  `baseRevision`, returns `{ revision, event }`, emits the mapped
  scriptstate event, and returns 409
  `{ error: "revision_conflict", currentRevision }` on stale input.
- Cover representative successful scriptstate updates/deletes,
  rollback/no revision bump on validation failure, 404 missing chat
  behavior, conflict retry where applicable, and no command dispatch
  outside Fastify mode.

Out of scope for 9-3e:

- Settings groups, bot presets, prompt templates/items, personas,
  translator presets, loadouts, character catalog/profile commands, and
  chat record/folder metadata commands.
- Generic message history commands; they landed in 9-3c.
- Generation persistence; it landed in 9-3d.
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
  reference fields owned by later slices. Do not loosen that in 9-3e.
- Chat metadata patches now reject fields owned by later slices:
  `message`, `localLore`, `scriptstate`, generation/runtime fields, and
  child collections. Do not loosen that in 9-3e; use message,
  generation, or scriptstate commands instead.
- Message patch commands now reject `generationInfo`; keep durable
  generation metadata on the 9-3d generation persistence command.
- Generation persistence command accepts a finalized assistant message
  snapshot and optional `targetMessageId` for continue-style replacement;
  do not use it for scriptstate.
- Message rows preserve existing `message.chatId` as the public message id.
  The 9-3c helpers normalize missing or duplicate ids during message
  command mutations.

## Later Queue

1. 9-3f - Compatibility setters and access adapters.
2. 9-4 - Lorebooks, modules, plugins, assets.
3. 9-5 - Browser projection.
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

Run focused command/scriptstate tests while building 9-3e, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-3d:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 680 tests passed, 4 skipped.
- `pnpm api:test` - 1093 tests passed.
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
  [`../phases-completed/phase-9-client-thinning-9-3d.md`](../phases-completed/phase-9-client-thinning-9-3d.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
