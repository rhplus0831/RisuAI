# Hydrated To Message-Free Sweep

Status: planned. The safe, helper-free first commit (Prerequisite 4).

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Prerequisite 4 and "Suggested implementation order" step 1; the appendix route
  table lists every route's current helper.
- `server/fastify/src/routes/commands.ts` - the route registrations.
- `server/fastify/src/commands/mutations.ts` - `applyJsonCommandMutation` →
  `applyMessageFreeJsonCommandMutation`.

## Scope

Swap every `hydrated` route that never reads or writes `chat.message[]` from
`applyJsonCommandMutation` to `applyMessageFreeJsonCommandMutation`. 64 of the 66
`hydrated` routes qualify; this removes the `loadPersistedWithMessages` call and
the `syncChatMessages` chat-row rewrite (a guaranteed no-op for these routes)
immediately, with no new helper.

This is a stopgap, not the fix: a `message-free` route still rewrites all
characters, all nine collection tables, and settings. It is the safe first commit
for every `hydrated` non-message route the later tiers will narrow further.

**Skip (keep their current helper):**

- 2390 `DELETE characters/:id` — orphan message rows are cleaned only because the
  hydrate lets `syncChatMessages` see them vanish (Phase 6).
- 2495 `POST characters/:id/chats` — duplicate message-id validation scans every
  chat's `message[]` corpus-wide (Phase 6).
- 2617 `DELETE chats/:id` — needs a targeted message delete (Phase 6).
- 2655 `POST chats/:id/fork` — writes the forked chat's new messages (Phase 3
  treats it as single-character-row + surgical messages).
- The six already-targeted message commands (3030, 3072, 3118, 3163, 3207, 3248),
  `characters/select` (2431), and `state/initialize` (1047).

The five routes already on `message-free` (settings/:group 1074, chats/:id 2560,
plugin-storage 4032/4066/4099) need no change here.

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts` only.
- Protocol surface: ~62 command routes, helper swap only.
- Durable path: drop the all-messages load and the chat-row rewrite; the broad
  character/collection/settings rewrite is unchanged (narrowed in later tiers).
- Revision/event behavior: byte-for-byte unchanged — the swap removes only the
  message load and the no-op `syncChatMessages`.
- Rollback/resync behavior: unchanged from the `hydrated` path.
- Non-scope: any per-row narrowing (later tiers), any projection change.

## Protocol Behavior

- `baseRevision`, one revision bump, and one command event are unchanged.
- The skipped routes keep their message handling exactly as today.

## Done When

- The ~62 swept routes report `mutationPath: "message-free"`.
- The four message-dependent routes (2390, 2495, 2617, 2655) are unchanged and
  handed to Phase 3/Phase 6.
- The metric shows the swept routes dropped the message-store read from their
  written-table set (load time falls; the broad table set otherwise stands).

## Validation

- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `pnpm api:test`
- `pnpm client-thinning:audit`
