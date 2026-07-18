# Stream ownership falls back to the wrong character or chat

## Summary

The stream consumer captures the selected character and chat as numeric indices.
It later remembers the chat ID, but if that ID cannot be found under the
character currently occupying the captured index, it deliberately falls back
to the chat at the old numeric index. A targeted character-list update can shift
indices while preserving resident chat bodies and correctly move the user's
selection by character ID. The already-running stream closure does not follow
that identity change, so subsequent tokens, cleanup state, and reload-key writes
can land in an unrelated character or chat.

## Location

- `src/ts/process/index.svelte.ts:411-483` starts response orchestration with
  `selectedChar` and `selectedChat` indices.
- `src/ts/process/postGeneration/streamResponse.ts:67-75` resolves the live
  character by captured index and falls back from `streamChatId` to
  `chats[selectedChat]` when the stable chat is absent.
- `src/ts/process/postGeneration/streamResponse.ts:76-84,106-121,139-184`
  appends/resolves the generated row and writes tokens/reload state through
  those helpers.
- `src/ts/process/postGeneration/streamResponse.ts:235-248` clears
  `isStreaming` and bumps reload state through the same potentially wrong owner.
- `src/ts/server/selectedCharacterRefresh.ts:19-61` documents that indices can
  name different characters after an authoritative replacement and resolves
  selection by character ID.
- `src/ts/server/resourceState.svelte.ts:2015-2044` applies targeted character
  collection updates while preserving resident chat bodies by default.
- `src/ts/bootstrap.ts:1536-1548,1571-1583` repairs the selected-character index
  by stable ID after resource invalidation without resetting targeted bodies.
- `src/ts/process/serverBackedSendChat.ts:500-523,566-582` resolves terminal
  generation data by stable character/chat identity, which can then disagree
  with where the stream renderer painted tokens.

## Trigger

1. Hydrate chats for characters A and B, with A selected at an index that is not
   the end of the collection, and start a streaming generation for A.
2. While the stream is active, apply a targeted character-list update that
   shifts A to another index while leaving B's chat body resident. A concrete
   cross-client case is permanently deleting a character positioned before A;
   selection follows A by ID, while the captured numeric index can now name B.
3. Let another token frame arrive after B occupies the captured index.

A related trigger removes/replaces the original chat while leaving the
character and another chat body resident. If `streamChatId` is no longer
present, the resolver falls back to whichever chat occupies the old
`selectedChat` index; message lookup can then fall back to the old message index
as well.

## Expected behavior

Every write produced by a generation must remain bound to the stable character
ID, chat ID, and message/generation ID captured for that job. If any owner no
longer exists, streaming should detach or stop updating local state. It must
never fall back to a different entity after stable ownership has been
established.

## Actual behavior

`currentLiveCharacter()` starts returning character B because it always reads
`characters[selectedChar]`. `currentLiveChat()` cannot find A's captured chat ID
inside B, so it returns B's chat at `selectedChat`. Once B has a resident body,
message lookup can fall back to `msgIndex` and a later frame can overwrite that
row with A's text. Frame application bumps B's reload key, and cleanup can set
B's `isStreaming` to false while leaving A's original chat marked as streaming.

The initial assistant append and `isStreaming = true` write happen
synchronously before the asynchronous read loop, so a later reorder does not
redirect those initial writes. The incorrect ownership begins with subsequent
frame and cleanup resolution.

Fastify still persists using the stable IDs in the generation request. Terminal
reconciliation likewise prefers those IDs, so the original chat can receive the
authoritative result while the unrelated chat retains stream pollution, or the
terminal handler can fail to find the removed original owner and leave the
wrong local writes behind.

## Underlying cause

Stable message retargeting was added without stable owner resolution. The
closure never captures `currentChar.chaId` for later lookup and never observes
the selected-character store's identity-preserving index update. The
`streamChatId` check is also weakened by `?? indexedChat`, turning disappearance
of the intended chat into permission to mutate a different chat.

Once a stable ID has been captured, an index can be a performance hint but
cannot be a correctness fallback. The resource refresh code explicitly
recognizes this rule for selection; the stream path does not.

## Affected data flow

1. **UI interaction:** The user starts Send/Continue/Regenerate for character A
   and chat A1.
2. **Client ownership:** `consumeStreamResponse()` receives numeric
   `selectedChar`/`selectedChat`, captures only `streamChatId`, and creates or
   locates its optimistic message.
3. **Request:** `POST /api/v1/generate/chat` carries stable character/chat IDs,
   so the server job remains owned by A/A1.
4. **Synchronization event:** A targeted collection update shifts the local
   character array while preserving resident bodies; selection is repaired to
   A's new index by ID.
5. **Stream response:** The next token uses the stale captured index, cannot
   find A1 beneath B, and falls back to B's indexed chat/message.
6. **Persistence:** Fastify finalizes the result against A/A1, not the row the
   renderer just mutated.
7. **Displayed state:** B can show A's generated text or receive incorrect
   cleanup/reload state while A is selected at its new index and later receives
   a separate terminal or hydrated result.

## Severity and likely user impact

**High.** This crosses data ownership boundaries and can display one
character's generated content in another character's transcript. Even if the
wrong write is only a client projection, users can edit or branch from it before
reload, causing follow-on commands against incorrect or nonexistent IDs.
Cleanup can also leave chats stuck in or incorrectly cleared from streaming
state.

## Recommended fix

1. Pass the stable `characterId` and `chatId` already known by the
   server-backed coordinator into the stream consumer.
2. Resolve the character globally by `chaId` and then the chat by `id` on every
   append, chunk, reload-key, and cleanup write. The captured indices may only be
   used after verifying those IDs still match.
3. Once `streamChatId` or a message ID exists, remove all index fallbacks. If an
   owner disappears, cancel/detach the renderer and request authoritative
   hydration.
4. Use the stable message/generation ID only; do not fall back to `msgIndex`
   after a stable target was previously present.
5. Keep the owner tuple in one stream-session object so terminal reconciliation
   and render cleanup cannot use different resolution rules.

## Test gap

Extend the controlled-stream tests with a targeted collection shift that keeps
both A and B chat bodies resident: move A away from its captured index between
token frames and assert only A/A1 changes. Add cases where the original chat and
target message are removed while another indexed chat is resident, asserting no
unrelated row or streaming flag is touched.
