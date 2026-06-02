# Phase 3: Single Row Paths

Status: planned. Depends on the Phase 0 writer kit (`writeSingleCharacterRow`,
`writeSingleChatRow`) and review gates.

Goal: narrow Tier-3 single character-row and single chat-row metadata edits from
a whole-DB rewrite to a one-row `UPDATE ... WHERE id=?`. Most of these are
`hydrated` despite touching no messages, so they also lose the all-messages load.
Narrowing the write never desyncs the projection (the foreign/recovery refresh
reads SQLite fresh); the matching narrow projection branch lands in Phase 5.

## Source Anchors

- [`../../mutation-range-mismatch.md`](../mutation-range-mismatch.md) - Tier 3.
- `server/fastify/src/routes/commands.ts` - the Tier-3 routes.
- `server/fastify/src/repository.ts` - `writeSingleCharacterRow`,
  `writeSingleChatRow` (no `chats` single-row writer exists today).
- `server/fastify/src/commands/mutations.ts` - targeted paths.

## Slices

- [`single-character-row-paths.md`](slices/phase-3-single-row-paths/single-character-row-paths.md) -
  characters/:id PATCH (2350, +settings on trash), characters/:id/lorebooks
  (3528), chat-folders create (2811) / PATCH (2853) / reorder (2939) / DELETE
  (2896, +that character's chat rows), chats/reorder (2758, that character's chat
  rows + its character row), per-character modules/reorder (3782, +modules table
  + enabledModules), chats/:id/fork (2655, source character row + its chat rows +
  surgical forked messages).
- [`single-chat-row-paths.md`](slices/phase-3-single-row-paths/single-chat-row-paths.md) -
  chats/:id/scriptstate (2983, hot path), chats/:id PATCH (2560, +parent
  character row when `select:true`), chats/:id/lorebooks (3564, `localLore`).

## Exit Criteria

- Each route writes only its target character or chat row, with the documented
  conditional co-writes (settings on trash; the character's chat rows on
  folder-delete/reorder; the `modules` table + `enabledModules` on per-character
  modules/reorder; the parent character row on chat select).
- chats/:id/fork keeps surgical forked-message persistence and treats
  cross-character validation/normalization as validate-only.
- The scriptstate write no longer hydrates every message or rewrites every
  character on the hot generation/script path.
- Rowid-stability tests prove unrelated character and chat rows are untouched.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
