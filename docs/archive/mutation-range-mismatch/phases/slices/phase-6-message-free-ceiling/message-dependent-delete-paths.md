# Message-Dependent Delete Paths

Status: implemented (verified at floor). Each route is held at its safe floor and
its blocker is proven by `commandMessageFreeCeiling.test.ts`. The deletes stay
below the deeper narrowing until the existing targeted message-delete helpers are
wired into these command scopes, or a reference-strip scope exists.

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
| `DELETE characters/:id` | `characters`/`chats` have no FK cascade to the message store, and there is no message GC (only `assetGc`). Orphaned message/`hypa_v3` rows are cleaned today only because the hydrated `syncChatMessages` diff sees them vanish from the baseline. A naive narrowing leaks message rows permanently. | Stays `hydrated` (the message load is a real dependency). Unblock to `message-free` only after `deleteChatMessages`/`deleteChatHypaV3` are wired over the deleted character's chat ids. Verifier: medium. |
| `DELETE chats/:id` | Same orphan-leak as the character delete: deleting a chat orphans that chat's message/`hypa_v3` rows, and only the hydrated `syncChatMessages` diff deletes them. The seed audit's optimistic "message-free floor now" was wrong — `message-free` here leaks the deleted chat's messages. The eventual scoped narrowing is the owning character's row (`chatPage`) + that character's chat rows + targeted message deletes. | Stays `hydrated` (orphan-cleanup message dependency). Unblock: wire `deleteChatMessages`/`deleteChatHypaV3` for the deleted chat id, then drop to a scoped per-character narrowing. Verifier: high. |
| `DELETE modules/:id` | `removeModuleReferences` strips the id from `enabledModules` (settings) + every `character.modules` + every `chat.modules` + every `loadout.modules` — spans characters, chats, the loadouts collection, and settings. No single-table lever applies. | `message-free` floor only (writes the full broad set). Verifier: medium. |

## Implementation Scope

- Source files: `server/fastify/src/routes/commands.ts` (helper choice),
  `server/fastify/src/messageStore.ts` (the targeted delete, when unblocking).
- This phase only records the blocker and keeps each route at its floor; it does
  not wire the targeted message deletes or scope `removeModuleReferences`.
- Revision/event behavior: unchanged from the current helper.
- Verified by `commandMessageFreeCeiling.test.ts`: the character/chat deletes
  report `mutationPath: 'hydrated'`, write the message store (`writtenTables`
  contains `messages`), and leave zero rows for the deleted chat id (orphan
  cleanup proven load-bearing); the module delete reports `message-free`, writes
  exactly the broad set, and strips the id from settings/characters/chats/loadouts.

## Done When

- characters/:id DELETE keeps faithful orphan-row cleanup at the `hydrated` floor;
  the unblock step (wire `deleteChatMessages`/`deleteChatHypaV3` for the route's
  chat ids) is recorded. (Done.)
- chats/:id DELETE is held at the `hydrated` floor (orphan-cleanup message
  dependency) with the scoped-narrowing target recorded; the seed audit's
  "message-free floor" was corrected. (Done.)
- modules/:id DELETE is at the `message-free` floor with the cross-table
  reference-strip blocker recorded. (Done.)
- No route here is narrowed below the floor. (Done.)

## Validation

- `pnpm api:test -- server/fastify/__tests__/commands.test.ts`
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- `pnpm api:test`
- `pnpm client-thinning:audit`
