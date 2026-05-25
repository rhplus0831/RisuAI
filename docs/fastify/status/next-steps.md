# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-3b landed chat record, chat-folder, and chat-level metadata command
coverage. The slice added Fastify chat create/update/delete/fork/reorder
routes, chat-folder create/update/delete/reorder routes, typed browser
helpers, and Fastify-mode client dispatch for chat selection, lifecycle,
forking, folder metadata, imports, author notes, persona binding, and
bookmarks while keeping local/Tauri mutation behavior intact.

## Immediate Pickup

Continue Phase 9 implementation with
**9-3c - Message history commands**.

Expected scope:

- Add message history command coverage according to
  `phase-9-command-map.md`:
  `POST /api/v1/commands/chats/:chatId/messages`,
  `PATCH /api/v1/commands/messages/:messageId`,
  `DELETE /api/v1/commands/messages/:messageId`,
  `POST /api/v1/commands/chats/:chatId/messages/truncate`, and
  `PUT /api/v1/commands/chats/:chatId/messages`.
- Add stable message-row ids in the current schema where needed. Existing
  rows already often use `message.chatId`; decide whether to preserve that
  field as the public message id or introduce/normalize a separate `id`
  before wiring commands.
- Replace server-backed web transcript append, edit, delete, truncate,
  disable, role/name, per-message bookmark-id setup, prompt-info edits,
  and whole-transcript replacement paths with typed commands while keeping
  Tauri/local mode on the existing mutation path.
- Keep chat record/folder metadata on the 9-3b commands. Do not widen
  `PATCH /api/v1/commands/chats/:chatId` to accept `message`,
  `localLore`, `scriptstate`, or generation persistence.
- Do not reopen settings groups, bot presets, prompt templates/items,
  personas, translator presets, loadouts, or character scalar/catalog
  commands in this slice.
- Tauri/local mode keeps existing local mutation paths.
- Preserve the 9-1 command contract: every command takes
  `baseRevision`, returns `{ revision, event }`, emits the mapped message
  event, and returns 409
  `{ error: "revision_conflict", currentRevision }` on stale input.
- Cover representative append/update/delete/truncate/replace flows,
  rollback/no-revision-bump on validation failure, 404 missing chat/message
  behavior, conflict retry where applicable, and no command dispatch
  outside Fastify mode.

Out of scope for 9-3c:

- Settings groups, bot presets, prompt templates/items, personas,
  translator presets, loadouts, character catalog/profile commands, and
  chat record/folder metadata commands.
- Generation-persistence and scriptstate commands; keep them in 9-3d and
  9-3e.
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
  reference fields owned by later slices. Do not loosen that in 9-3c.
- Chat metadata patches now reject fields owned by later slices:
  `message`, `localLore`, `scriptstate`, generation/runtime fields, and
  child collections. Do not loosen that in 9-3c; use message commands
  instead.

## Queue After 9-3b

1. 9-3d - Generation persistence handoff.
2. 9-3e - Chat `scriptstate` and scripting side effects.
3. 9-3f - Compatibility setters and access adapters.
4. 9-4 - Lorebooks, modules, plugins, assets.
5. 9-5 - Browser projection.
6. 9-6 - Storage and provider-key gating.
7. 9-7 - Server `.risu` codec core.
8. 9-8 - Import/export routes and bundle assets.
9. 9-9 - Full server-backed fixture sweep and closeout.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run focused command/message tests while building 9-3c, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-3b:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 679 tests passed, 4 skipped.
- `pnpm api:test` - 1087 tests passed.
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
  [`../phases-completed/phase-9-client-thinning-9-3b.md`](../phases-completed/phase-9-client-thinning-9-3b.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
