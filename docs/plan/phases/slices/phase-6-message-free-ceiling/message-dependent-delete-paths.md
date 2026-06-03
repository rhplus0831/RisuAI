# Message-Dependent Delete Paths

Status: planned. Blocked below the `message-free` floor until the existing
targeted message-delete helpers are wired into these command scopes, or a
reference-strip scope exists.

## Source Anchors

- [`../../../mutation-range-mismatch.md`](../../../mutation-range-mismatch.md) -
  Tier 5 delete entries.
- `server/fastify/src/routes/commands.ts` - DELETE characters/:id, DELETE
  chats/:id, DELETE modules/:id.
- `server/fastify/src/messageStore.ts` - the surgical message writers and the
  `deleteChatMessages`/`deleteChatHypaV3` that narrowing would require.

## Scope

| Route | Blocker | Floor / unblock |
| --- | --- | --- |
| `DELETE characters/:id` | `characters`/`chats` have no FK cascade to the message store; orphaned message/`hypa_v3` rows are cleaned today only because `syncChatMessages` sees them vanish from the hydrated baseline. A naive narrowing leaks message rows permanently. | Keep message handling (stays `hydrated`, or `message-free` only after `deleteChatMessages`/`deleteChatHypaV3` are wired over the deleted character's chat ids). Verifier: medium. |
| `DELETE chats/:id` | Reduces to the owning character's row (`chatPage`) + that character's chat rows + targeted message deletes — a scoped narrowing, not a single row. | `message-free` floor now; full scoped narrowing once the delete helpers are wired into this route. Verifier: high. |
| `DELETE modules/:id` | `removeModuleReferences` strips the id from `enabledModules` (settings) + every `character.modules` + every `chat.modules` + every `loadout.modules` — spans characters, chats, two collection tables, and settings. No single-table lever applies. | `message-free` floor only. Verifier: medium. |

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts` (helper choice),
  `server/fastify/src/messageStore.ts` (the targeted delete, when unblocking).
- This phase only records the blocker and keeps each route at its floor; it does
  not wire the targeted message deletes or scope `removeModuleReferences`.
- Revision/event behavior: unchanged from the current helper.

## Done When

- characters/:id DELETE keeps faithful orphan-row cleanup at its current floor;
  the unblock step (wire `deleteChatMessages`/`deleteChatHypaV3` for the route's
  chat ids) is recorded.
- chats/:id DELETE is at the `message-free` floor with the scoped-narrowing target
  recorded.
- modules/:id DELETE is at the `message-free` floor with the cross-table
  reference-strip blocker recorded.
- No route here is narrowed below the floor.

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
