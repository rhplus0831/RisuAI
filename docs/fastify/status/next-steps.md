# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice details
live in [`../phases-completed/`](../phases-completed/).

Policy note: no actual Fastify users exist yet; update current schemas and
import paths directly instead of preserving intermediate Fastify shapes.

## Last Done

9-3a landed the character catalog and scalar profile command bridge. The
slice added character `chaId` normalization and scalar patch validation,
Fastify character create/update/delete/select/reorder routes, typed
browser character command helpers with revision lookup and one conflict
retry, and routed server-backed create/import/select/delete/trash/restore,
catalog reorder/folder metadata, playground setup, and debounced scalar
profile edits through commands in Fastify mode while keeping local/Tauri
mutation behavior intact.

## Immediate Pickup

Continue Phase 9 implementation with
**9-3b - Chat records, folders, and metadata**.

Expected scope:

- Add chat record and chat-folder command coverage according to
  `phase-9-command-map.md`:
  `POST /api/v1/commands/characters/:characterId/chats`,
  `PATCH /api/v1/commands/chats/:chatId`,
  `DELETE /api/v1/commands/chats/:chatId`,
  `POST /api/v1/commands/chats/:chatId/fork`,
  `POST /api/v1/commands/characters/:characterId/chats/reorder`,
  `POST /api/v1/commands/characters/:characterId/chat-folders`,
  `PATCH /api/v1/commands/chat-folders/:folderId`,
  `DELETE /api/v1/commands/chat-folders/:folderId`, and
  `POST /api/v1/commands/characters/:characterId/chat-folders/reorder`.
- Replace server-backed web chat record, chat page/current-chat,
  chat-folder, notes, persona binding, and bookmark metadata mutation
  paths with typed commands while keeping Tauri/local mode on the existing
  mutation path.
- Preserve current chat behavior and stable `chat.id` addressing.
- Do not reopen settings groups, bot presets, prompt templates/items,
  personas, translator presets, loadouts, or character scalar/catalog
  commands in this slice.
- Tauri/local mode keeps existing local mutation paths.
- Preserve the 9-1 command contract: every command takes
  `baseRevision`, returns `{ revision, event }`, emits the mapped chat or
  chat-folder event, and returns 409
  `{ error: "revision_conflict", currentRevision }` on stale input.
- Cover representative chat create/update/delete/fork/reorder and
  chat-folder create/update/delete/reorder flows, rollback/no-revision-bump
  on validation failure, conflict retry where applicable, and no command
  dispatch outside Fastify mode.

Out of scope for 9-3b:

- Settings groups, bot presets, prompt templates/items, personas,
  translator presets, loadouts, and character catalog/profile commands.
- Message history, generation-persistence, and scriptstate commands; keep
  them in 9-3c through 9-3e.
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
  reference fields owned by later slices. Do not loosen that in 9-3b.
- 9-3b should validate chat ownership by parent `characterId`; public
  command payloads must use `chat.id` and folder ids rather than array
  indexes.

## Queue After 9-3a

1. 9-3c - Message history commands.
2. 9-3d - Generation persistence handoff.
3. 9-3e - Chat `scriptstate` and scripting side effects.
4. 9-3f - Compatibility setters and access adapters.
5. 9-4 - Lorebooks, modules, plugins, assets.
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

Run focused command/chat tests while building 9-3b, then
before closing the slice run the full matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 9-3a:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 678 tests passed, 4 skipped.
- `pnpm api:test` - 1084 tests passed.
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
  [`../phases-completed/phase-9-client-thinning-9-3a.md`](../phases-completed/phase-9-client-thinning-9-3a.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
