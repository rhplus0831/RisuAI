# Phase 3: Single Row Paths

Status: implemented (`07971179`→`65e57c0a` on `fastify`, four stages). All 12
Tier-3 routes now write only their target character/chat row(s) and the
documented co-writes: stage a = six pure single-character-row routes, stage b =
three single-chat-row routes (incl. the hot scriptstate path), stage c = the two
character+chat-row cascade routes (chat-folders DELETE, chats/reorder), stage d =
fork (surgical character/chat/message writes). The `targeted-character-row` gate
was widened to {characters, chats, settings} (+ message-store tables for fork)
while forbidding the nine other-collection tables; `writeCharacterChatRows` and
`insertCharacterChatRow` were added to the writer kit.

Goal: narrow Tier-3 character/chat metadata edits to
`UPDATE ... WHERE id=?`. Most are `hydrated` despite touching no messages, so
they also drop the all-message load. Projection stays correct because refresh
reads SQLite fresh; Phase 5 has added the narrower refresh shapes.

## Source Anchors

- [`../mutation-range-mismatch.md`](../mutation-range-mismatch.md) - Tier 3.
- `server/fastify/src/routes/commands.ts` - the Tier-3 routes.
- `server/fastify/src/repository.ts` - `writeSingleCharacterRow`,
  `writeSingleChatRow`.
- `server/fastify/src/commands/mutations.ts` - targeted paths.
- [`slices/phase-0-baseline-foundations/normalization-scope-policy.md`](slices/phase-0-baseline-foundations/normalization-scope-policy.md) -
  the validate-only / settings co-write contract (Prerequisites 2-3) and the
  shared `assertOnlyRowsWritten` rowid-stability helper this phase's slices use.

## Slices

- [`single-character-row-paths.md`](slices/phase-3-single-row-paths/single-character-row-paths.md) -
  characters/:id PATCH (+settings on trash), characters/:id/lorebooks,
  chat-folders create/PATCH/reorder/DELETE (+that character's chat rows),
  chats/reorder (that character's chat rows + its character row),
  per-character modules/reorder (character row only; module repairs
  validate-only), and chats/:id/fork (source character row + its chat rows +
  surgical forked messages).
- [`single-chat-row-paths.md`](slices/phase-3-single-row-paths/single-chat-row-paths.md) -
  chats/:id/scriptstate (hot path), chats/:id PATCH (+parent character row when
  `select:true`), and chats/:id/lorebooks (`localLore`).

## Exit Criteria

- Each route writes only its target character or chat row, with the documented
  conditional co-writes (settings on trash; the character's chat rows on
  folder-delete/reorder; the parent character row on chat select). Per-character
  modules/reorder writes only the character row.
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
