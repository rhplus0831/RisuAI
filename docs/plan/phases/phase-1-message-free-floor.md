# Phase 1: Message-Free Floor

Status: planned.

Goal: apply the cheap floor. Swap safe `hydrated` non-message routes to
`applyMessageFreeJsonCommandMutation`. This removes the all-message load and the
`syncChatMessages` no-op without new helpers. It is a stopgap: `message-free`
still rewrites characters, nine collection tables, and settings.

## Source Anchors

- [`../mutation-range-mismatch.md`](../mutation-range-mismatch.md) -
  Prerequisite 4 and "Suggested implementation order" step 1.
- `server/fastify/src/routes/commands.ts` - the routes to swap.
- `server/fastify/src/commands/mutations.ts` - `applyJsonCommandMutation` vs
  `applyMessageFreeJsonCommandMutation`.

## Slices

- [`hydrated-to-message-free-sweep.md`](slices/phase-1-message-free-floor/hydrated-to-message-free-sweep.md) -
  the single mechanical commit across ~62 routes, skipping the message-dependent
  ones (2390, 2495, 2617, 2655) and the already-targeted message commands and
  seed route.

## Exit Criteria

- Every `hydrated` route that never reads or writes `chat.message[]` reports
  `mutationPath: "message-free"`.
- The four message-dependent routes (2390, 2495, 2617, 2655) remain on their
  current helper and are handed to Phase 3 (fork) or Phase 6 (the deletes and the
  chats-create validation).
- Revision conflict, event, and response shapes are byte-for-byte unchanged from
  the `hydrated` path (the swap removes only the message load and chat-row
  rewrite).

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
