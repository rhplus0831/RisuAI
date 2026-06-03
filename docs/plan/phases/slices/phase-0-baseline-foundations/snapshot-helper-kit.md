# Snapshot Helper Kit

Status: planned. Phase 0. Adds the scalar/single-row/single-chat snapshot+restore
pairs the later phases import. No call site is rewired here.

## Scope

Generalize the reference fix's `CharacterSelectionSnapshot` /
`currentCharacterSelectionSnapshot` / `restoreCharacterSelection` into a small
family of narrow snapshot+restore pairs, each cloning only the slice a hot path
mutates and restoring only that slice under `withTrustedServerProjectionWrite`.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the shared root-cause note and the per-finding "recommended fix" sections that
  name each helper.
- `src/ts/characterCommands.ts` - the reference pair to mirror.
- `src/ts/chatCommands.ts` - `currentChatStateSnapshot`/`restoreChatState`,
  `cloneJsonValue`, `prepareCompatibleChatUpdate`/`snapshotChat`.
- `src/ts/server/lorebookBridge.svelte.ts` - `currentLorebookStateSnapshot`,
  the existing `scopedLorebookStateSnapshot`/`restoreScopedLorebookState`.

## Helpers To Add

| Helper | Captures | Restores | For |
| --- | --- | --- | --- |
| `currentChatScopedSnapshot()` / `restoreChatScopedState()` (`chatCommands.ts`) | `{ selectedCharID, charIndex/chaId, chatPage/chatId, chat: cloneJsonValue(activeChat) }` — only the active chat row (its `message[]`, `scriptstate`, metadata) | only that one chat row | message edit/delete/bookmark/replace/send, slash-command message mutation, reroll/swipe |
| `ChatScriptstateSnapshot` + `currentChatScriptstateSnapshot()` / `restoreChatScriptstate()` (`chatCommands.ts`) | `{ chatId, selectedCharID, scriptstate: shallowClone(chat.scriptstate) }` (+ optional `note` scalar) | only that chat's `scriptstate` (+ `note`), located by id | `setVar`/`setChatVar`/`/setvar`/`/addvar`, `v2SetAuthorNote` |
| `CharacterRowSnapshot` + `currentCharacterRowSnapshot()` / `restoreCharacterRow()` (`characterCommands.ts`) | `{ index, characterId, character: cloneJsonValue(thatOneRow), currentChar?, selectedCharID }` | only `DBState.db.characters[index]` (+ `selectedCharID`/`currentChar` scalars) | `setCurrentCharacter`/`setCharacterByIndex`, character field edits, image/emotion |
| `currentGlobalLorebookStateSnapshot()` / `restoreGlobalLorebookState()` (`lorebookBridge.svelte.ts`) | `{ loreBook: cloneJsonValue(DBState.db.loreBook ?? []), loreBookPage, selectedCharID }` — characters/modules omitted | only `loreBook` + `loreBookPage` | global-lorebook select/create/delete |
| (reuse) `scopedLorebookStateSnapshot('character:'+chaId, prevGlobalLore)` / `restoreScopedLorebookState` | one character's `globalLore` captured before the in-place edit | only that character's `globalLore` | the 6 lorebook trigger effects |

## Implementation Notes

- Each `current*Snapshot` clones with the file's existing `cloneJsonValue` for
  the single-row payload (bounded) and reads scalars directly; never touch
  `DBState.db.characters` as a whole.
- Each `restore*` wraps its writes in `withTrustedServerProjectionWrite` and
  locates the target by stable id (the reference fix uses
  `characters.find(c => c.chaId === id)`), so a stale index cannot clobber the
  wrong row.
- `ChatScriptstateSnapshot` shallow-clones only the `scriptstate` map (small
  key/value object), not the chat; `note` is a scalar.
- Do not modify the heavy `current*StateSnapshot` / `restore*State`; they stay for
  create/delete/reorder/fork (Prerequisite 4).

## Done When

- The five helper pairs exist and are exported, each with a unit test proving the
  snapshot omits `characters`/`characterOrder`/`modules`/`message` payload
  (`not.toHaveProperty('characters')`) and the restore writes back only the
  intended slice while unrelated rows keep their values (the reference fix's two
  tests, per helper).
- No existing call site changed; `pnpm test` and the type checks are green.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/compatibilityAdapters.test.ts`
- `pnpm test`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
