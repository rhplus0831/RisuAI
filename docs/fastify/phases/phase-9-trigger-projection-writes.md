# Phase 9 - Trigger Collection/Chat Projection Writes

Date: 2026-05-27

Status: closed. Fixed 2026-05-27; see
[`../phases-completed/phase-9-trigger-collection-chat-projection-writes.md`](../phases-completed/phase-9-trigger-collection-chat-projection-writes.md).

## Finding

`runTrigger` in `src/ts/process/triggers.ts` still applies several durable
trigger data effects by writing the live `DBState.db` projection directly
instead of routing through a typed command. In server-backed web mode the
read-only projection guard (`src/ts/server/projectionWriteGuard.svelte.ts`,
enabled at `src/ts/bootstrap.ts`) turns those writes into a thrown
`TypeError`, so the effects fail loudly rather than persisting through a
command.

A sibling slice already closed the **scalar** character/persona trigger
effects, the scripting `declareAPI` character setters, and two UI sites by
routing them through `setCharacterByIndex` / `saveUserPersona`; see
[`../phases-completed/phase-9-trigger-scalar-projection-writes.md`](../phases-completed/phase-9-trigger-scalar-projection-writes.md).
This file tracks the remaining **collection / chat** effects, which were
intentionally left untouched because they need different command routing.

## Why the scalar fix does not apply here

`setCurrentCharacter` / `setCharacterByIndex` route through
`dispatchCompatibleCharacterUpdate`, whose diff
(`changedCharacterFields`) skips `CHARACTER_PATCH_EXCLUDED_KEYS`
(`src/ts/characterCommands.ts`). That set includes `globalLore` and
`chats`. So routing these effects through the character command would
stop the guard throw but **silently drop the change server-side** - worse
than the current loud failure. Each effect needs its own owning command:

- Character `globalLore` edits belong on the character-lorebook bridge
  (`src/ts/server/lorebookBridge.svelte.ts`, the 9-4a path).
- Chat `note` edits belong on the chat-metadata command
  (`dispatchCompatibleChatUpdate` / `dispatchUpdateChat` in
  `src/ts/chatCommands.ts`, the 9-3b path), with a correct
  previous-chat-state snapshot.

## Affected sites (`src/ts/process/triggers.ts`)

Line numbers are as of `65ca216e`; re-grep before editing.

| Effect case                 | Direct write                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `v2ModifyLorebook`          | `db.characters[selectedCharId].globalLore = char.globalLore`                                                       |
| `v2SetLorebookActivation`   | `db.characters[selectedCharId].globalLore = char.globalLore`                                                       |
| `v2CreateLorebook`          | `db.characters[selectedCharId].globalLore = char.globalLore`                                                       |
| `v2ModifyLorebookByIndex`   | `db.characters[selectedCharId].globalLore = char.globalLore`                                                       |
| `v2DeleteLorebookByIndex`   | `db.characters[selectedCharId].globalLore = char.globalLore`                                                       |
| `v2SetLorebookAlwaysActive` | `db.characters[selectedCharId].globalLore = char.globalLore`                                                       |
| `v2SetAuthorNote`           | `db.characters[selectedCharId].chats[page].note = value` (also mutates the live `getCurrentCharacter()` chat slot) |

Each case mutates the cloned `char` (or `currentCharacter`) and then
re-writes the live `DBState.db` projection; the projection re-write is the
guard violation.

## Reachability note

These are lower-confidence runtime hits than the already-fixed scripting /
UI sites. `setVar` in the same file writes the live projection too, yet the
server-backed browser smoke passes - which implies most trigger
data-mutation effects run server-side (`server/fastify/src/prompt/triggerDataEffects.ts`)
in server-backed mode, and the durable character/persona/lorebook/note
get+set pairs are explicitly deferred there (see that file's header). Client
`runTrigger` still runs these for `manual` / `output` / `input` / `request`
modes, so the guard can still fire. Confirm the live reach when picking this
up.

## Prescribed approach

- Route the six `globalLore` effects through the character-lorebook bridge
  with a correct previous-state snapshot and rollback, mirroring the 9-4a
  command flow; drop the redundant live-projection write.
- Route `v2SetAuthorNote` through the chat-metadata command, taking a chat
  snapshot before the mutation; drop the live `getCurrentCharacter()` chat
  write.
- Decide explicitly whether `display`-mode runs stay local-only (they
  already branch on `arg.displayMode`).

## Exit criteria

- No remaining direct `DBState.db` projection writes in the trigger
  collection/chat effect arms outside `display`-mode/local branches.
- Focused regression test (extend
  `src/ts/process/__tests__/triggers.projectionGuard.test.ts`) proving each
  effect routes through its command under the enabled guard and does not
  throw.
- `pnpm check`, `pnpm test`, `pnpm api:test`, `pnpm build`, and
  `pnpm smoke:fastify-browser` stay green.
