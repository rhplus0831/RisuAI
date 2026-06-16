# Chat, Message, And Chat List Updates Audit

Date: 2026-06-16

Status: bad

## Scope

Verified chat list operations, chat folders, bookmarks, author note, message
edit/delete, reroll/regenerate, suggestions, and composer/file state.

## Result

Several same-tab server-mode updates persist by command but do not apply visible
state locally. Because own command echoes are skipped after the command response
advances the cached revision, these flows can look like they failed in the
originating tab.

## Evidence

- `src/ts/server/commands.ts:2817` runs commands and updates revision/rollback
  state; it does not apply returned projection data.
- `src/ts/bootstrap.ts:335` skips own command events.
- Sidebar fork dispatches only in server mode at
  `src/lib/SideBars/SideChatList.svelte:137`.
- Chat reorder and folder reorder dispatch without applying the new arrays at
  `src/lib/SideBars/SideChatList.svelte:281` and `:343`.
- Folder create/toggle/delete are command-only in server mode around
  `src/lib/SideBars/SideChatList.svelte:443`, `:527`, and `:884`.
- Modal chat rename is explicitly tested as non-local in
  `src/lib/Others/ChatList.svelte.test.ts:401`.
- Bookmark modal rename/remove are tested to leave guarded state unchanged in
  `src/lib/Others/projectionGuard.test.ts:157`.
- `src/lib/SideBars/AuthorNoteEditor.svelte:70` persists through a 250 ms timer,
  but cleanup clears that timer without flushing.
- `src/ts/process/rerollNavigation.svelte.ts:201` starts regeneration
  immediately after fire-and-forget truncate dispatch, so generation can race the
  persisted truncate.
- `src/lib/ChatScreens/Suggestion.svelte:284` clears suggestions only locally
  when using one for send; persisted `suggestMessages` can reappear.
- `src/lib/ChatScreens/DefaultChatScreen.svelte:360` and `:389` clear files and
  composer text before append/generation success is known.

## Verification

Existing suites pass but confirm the current behavior:

- `pnpm exec vitest run src/ts/chatCommands.test.ts src/lib/Others/projectionGuard.test.ts src/lib/Others/ChatList.svelte.test.ts src/lib/SideBars/SideChatList.svelte.test.ts src/ts/server/chatMessageHydration.test.ts src/ts/process/rerollNavigation.rollback.test.ts src/lib/ChatScreens/Suggestion.svelte.test.ts`
- Main broader chat run: 11 files, 121 tests passed.
- Backend command/projection run: 11 files, 368 tests passed.

## Follow-Up

Make each same-tab command path either perform a trusted optimistic projection
write or apply returned projection data. Also flush author-note edits on
unmount, serialize reroll truncate before generation, persist suggestion clears,
and restore composer/file input on append failure.
