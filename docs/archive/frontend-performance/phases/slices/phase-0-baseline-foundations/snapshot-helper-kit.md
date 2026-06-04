# Snapshot Helper Kit

Status: implemented. Phase 0. Adds narrow snapshot+restore pairs for later
phases. No call site is rewired here.

Landed: the five helper pairs below exist and are exported
(`chatCommands.ts`/`characterCommands.ts`/`lorebookBridge.svelte.ts`), the scoped
lorebook pair is now exported, and `Phase 0` describe blocks in the three command
suites prove each snapshot/restore touches only its slice. The heavy
`current*StateSnapshot`/`restore*State` helpers are untouched.

## Scope

Generalize `CharacterSelectionSnapshot` into a small family of helpers. Each
helper clones only the slice a hot path mutates and restores only that slice
under `withTrustedServerProjectionWrite`.

## Source Anchors

- [`../../../../../frontend-performance-audit.md`](../../../frontend-performance-audit.md) -
  the shared root-cause note and the per-finding "recommended fix" sections that
  name each helper.
- `src/ts/characterCommands.ts` - the reference pair to mirror.
- `src/ts/chatCommands.ts` - `currentChatStateSnapshot`/`restoreChatState`,
  `cloneJsonValue`, `prepareCompatibleChatUpdate`/`snapshotChat`.
- `src/ts/server/lorebookBridge.svelte.ts` - `currentLorebookStateSnapshot`,
  the existing `scopedLorebookStateSnapshot`/`restoreScopedLorebookState`.

## Helpers Added

- `currentChatScopedSnapshot()` / `restoreChatScopedState()`
  (`chatCommands.ts`)
  Captures: selected character/chat ids plus `cloneJsonValue(activeChat)`.
  Restores: that one chat row.
  Used for: message edit/delete/bookmark/replace/send, slash-command message
  mutation, reroll/swipe.
- `ChatScriptstateSnapshot`, `currentChatScriptstateSnapshot()`, and
  `restoreChatScriptstate()` (`chatCommands.ts`)
  Captures: `{ chatId, selectedCharID, scriptstate }`, plus optional `note`.
  Restores: that chat's `scriptstate` and optional `note`.
  Used for: `setVar`, `setChatVar`, `/setvar`, `/addvar`, `v2SetAuthorNote`.
- `CharacterRowSnapshot`, `currentCharacterRowSnapshot()`, and
  `restoreCharacterRow()` (`characterCommands.ts`)
  Captures: index/id, one cloned character row, and selection scalars.
  Restores: that character row plus `selectedCharID` / `currentChar`.
  Used for: `setCurrentCharacter`, `setCharacterByIndex`, and character field
  edits routed through those helpers. Image/emotion and other lower-frequency
  callers remain broad pending Phase 7.
- `currentGlobalLorebookStateSnapshot()` / `restoreGlobalLorebookState()`
  (`lorebookBridge.svelte.ts`)
  Captures: `loreBook`, `loreBookPage`, and `selectedCharID`.
  Restores: `loreBook` and `loreBookPage`.
  Used for: global-lorebook select/create/delete.
- Reuse `scopedLorebookStateSnapshot('character:'+chaId, prevGlobalLore)` /
  `restoreScopedLorebookState`.
  Captures and restores one character's `globalLore`.
  Used for: the 6 lorebook trigger effects.

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
- The heavy `current*StateSnapshot` / `restore*State` helpers remain for true
  restructures and deferred lower-frequency callers; later slices should only keep
  hot paths from reaching them.

## Done

- The five helper pairs exist and are exported. Unit tests prove each snapshot
  omits full collections and each restore writes only the intended slice.
- No existing call site changed; `pnpm test` and the type checks are green.

## Validation

- `pnpm test -- src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/server/lorebookBridge.test.ts src/ts/compatibilityAdapters.test.ts`
- `pnpm test`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
