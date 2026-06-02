# Message-Dependent Delete Paths

Status: planned. Blocked below the `message-free` floor until a targeted message
delete or a reference-strip scope exists.

## Source Anchors

- [`../../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 5 entries for 2390, 2617, 3673.
- `server/fastify/src/routes/commands.ts` - DELETE characters/:id (2390), DELETE
  chats/:id (2617), DELETE modules/:id (3673).
- `server/fastify/src/messageStore.ts` - the surgical message writers and the
  `deleteChatMessages`/`deleteChatHypaV3` that narrowing would require.

## Scope

| Route (line) | Blocker | Floor / unblock |
| --- | --- | --- |
| `DELETE characters/:id` (2390) | `characters`/`chats` have **no FK cascade to the message store**; orphaned message/`hypa_v3` rows are cleaned today only because `syncChatMessages` sees them vanish from the hydrated baseline. A naive narrowing **leaks message rows permanently**. | Keep message handling (stays `hydrated`, or `message-free` only after a targeted `deleteChatMessages`/`deleteChatHypaV3` over the deleted character's chat ids exists). Verifier: medium. |
| `DELETE chats/:id` (2617) | Reduces to the owning character's row (`chatPage`) + that character's chat rows + a targeted message delete — a scoped narrowing, not a single row. | `message-free` floor now; full scoped narrowing once a targeted message delete exists. Verifier: high. |
| `DELETE modules/:id` (3673) | `removeModuleReferences` strips the id from `enabledModules` (settings) + every `character.modules` + every `chat.modules` + every `loadout.modules` — spans characters, chats, two collection tables, and settings. No single-table lever applies. | `message-free` floor only. Verifier: medium. |

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts` (helper choice),
  `server/fastify/src/messageStore.ts` (the targeted delete, when unblocking).
- This phase only records the blocker and keeps each route at its floor; it does
  **not** add the targeted message delete or scope `removeModuleReferences`.
- Revision/event behavior: unchanged from the current helper.

## Done When

- 2390 keeps faithful orphan-row cleanup at its current floor; the unblock step
  (targeted `deleteChatMessages`/`deleteChatHypaV3`) is recorded.
- 2617 is at the `message-free` floor with the scoped-narrowing target recorded.
- 3673 is at the `message-free` floor with the cross-table reference-strip blocker
  recorded.
- No route here is narrowed below the floor.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
