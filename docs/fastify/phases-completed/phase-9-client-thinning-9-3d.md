# Phase 9 Client Thinning - 9-3d Generation Persistence

Date: 2026-05-25

9-3d is closed. It moves durable server-backed generation result writes
behind a typed Fastify command while keeping transient streaming display
state in the browser.

## Landed

- Added `generation.persisted` command events.
- Added `POST /api/v1/commands/chats/:chatId/generation-result`.
- Added generation result validation for assistant message snapshots,
  required `generationInfo`, optional `promptInfo`, and optional
  `targetMessageId` replacement for continue-style generation.
- Added typed browser helper support in `src/ts/server/commands.ts` and
  dispatch plumbing in `src/ts/chatCommands.ts`.
- Routed server-backed `sendChat` generation closeout through the new
  command after terminal metadata and stage-4 finalization.
- Kept streaming row creation and token display browser-local; only the
  final assistant message snapshot is persisted.

## Notes For Later Slices

- 9-3e still owns chat `scriptstate` and scripting side effects. The
  generation persistence command intentionally does not accept scriptstate
  patches.
- Generic message append/update/delete/truncate/replace remains on the
  9-3c message commands. Do not widen message patch commands to accept
  `generationInfo`.
- Reroll button edits still use 9-3c message update/replace commands.
  The 9-3d command persists the generated assistant row that seeds those
  later reroll operations.
- 9-5 still owns the residual direct-write sweep and read-only
  `DBState.db` guard.

## Covered

- Successful generation result append and targeted replacement.
- `generation.persisted` response/event shape and bootstrap visibility.
- Validation/no-revision-bump behavior for malformed assistant rows and
  missing `generationInfo`.
- 404 missing chat and missing target message behavior.
- 409 stale-revision behavior.
- Browser helper request shape for generation result persistence.
- Server-backed sendChat fixture sweep with the extra command dispatch.

## Verification

Passed before closeout:

```bash
pnpm test -- src/ts/server/commands.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
pnpm api:test -- commands.test.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Results:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 680 tests passed, 4 skipped.
- `pnpm api:test` - 1093 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Continue Phase 9 with **9-3e - Chat `scriptstate` and scripting side
effects**:

- Add the chat scriptstate command from the locked command map:
  `PATCH /api/v1/commands/chats/:chatId/scriptstate`.
- Move runtime script variable and chat-state writes behind the command
  in server-backed web mode.
- Keep trigger definitions, lorebook/script child collections, projection
  enforcement, plugin bridges, and compatibility adapters in their later
  assigned slices.
