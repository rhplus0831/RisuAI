# Stream frames overwrite concurrent message edits

## Summary

The streaming renderer writes every accumulated chunk directly into the live
target message's `data` field. It relocates the target by message ID, but it does
not verify that the message has remained owned by the stream or that another
mutation changed it since the last frame. A message edit made while a Continue
generation is streaming can be accepted by Fastify and painted by the command
projection, then be overwritten in the browser by the next stream frame.

This is a stream-rendering race. It is separate from terminal server
finalization replacing other fields in the persisted row.

## Location

- `src/lib/ChatScreens/Chats.svelte:177-180` hides message actions only for an
  empty final generation placeholder, not an existing Continue target.
- `src/lib/ChatScreens/Chat.svelte:980-1010,2126-2147` allows the target message
  to be edited and dispatches a scoped message update.
- `src/ts/chatCommands.ts:4775-4869` marks chat message mutation intent and
  captures a chat-body projection fence for that update.
- `src/ts/process/postGeneration/streamResponse.ts:85-104` captures the
  Continue prefix and target message ID.
- `src/ts/process/postGeneration/streamResponse.ts:125-147` relocates the live
  target row.
- `src/ts/process/postGeneration/streamResponse.ts:164-184` computes the next
  stream value and assigns `target.message.data = nextData` without checking a
  mutation or projection epoch.
- `src/ts/process/__tests__/streamResponse.test.ts:457-487` currently codifies
  the unsafe result: a row changed to `projection final` is expected to be
  overwritten with `server stream` when the stream settles.
- `server/fastify/src/routes/commands.ts:6235-6303` persists the independent
  message edit.

## Trigger

1. Start **Continue** on an existing assistant message.
2. While tokens are arriving, edit that assistant message and save it.
3. Let the message `PATCH` update SQLite and the optimistic/resource projection.
4. Let another animation-frame flush or the stream's final `settle()` run.

The same race can occur if another command projection or authoritative
hydration replaces the target row while `processScriptFull()` is awaiting.

## Expected behavior

Once a user edit or newer authoritative projection changes the target message,
the older stream must not assign over it. The stream should stop, surface a
conflict, or remain a separate overlay that can be explicitly merged. The live
row should continue to show the accepted edit.

## Actual behavior

The next frame resolves the stable message ID in the latest array and then
blindly assigns the stream's accumulated text. Stable identity prevents an
index-only write to a moved row, but it does not establish write ownership. The
browser therefore reverts to stream text even though the durable message edit
can contain the newer value.

For Continue, Fastify's later generation-finalization freshness check may notice
the changed `data` and reject the generation result. That server rejection does
not repair the already overwritten client row; it can instead combine with the
separate optimistic-reply cleanup issue.

## Underlying cause

The message-command path already has concurrency signals:
`markChatMessageMutationIntent()` and the chat-body projection epoch. The stream
path is a trusted direct resource writer outside that protocol. It captures a
prefix and stable ID, but no expected message value, mutation-intent epoch,
projection epoch, or stream-owner token. Neither the asynchronous script pass
nor the final assignment performs compare-and-set validation.

The existing test at
`src/ts/process/__tests__/streamResponse.test.ts:457-487` treats target
relocation and write ownership as the same concern. It correctly verifies that
the stream finds a row after array replacement, but its final expectation
explicitly requires the newer row value to lose. That expectation masks this
regression.

## Affected data flow

1. **UI interaction:** Continue starts on a durable assistant row; the user then
   edits that same row.
2. **Client state:** The edit command paints the new `data`, records mutation
   intent, and registers a scoped optimistic attempt.
3. **Request:** `PATCH /api/v1/commands/messages/:messageId` sends the edited
   `data` and base revision.
4. **Server persistence:** Fastify updates the identified message and returns a
   revision/event.
5. **Generation response:** `/api/v1/generate/chat` continues delivering token
   chunks independently.
6. **Displayed state:** `applyLatestChunk()` resolves the same stable ID and
   overwrites `message.data` with `prefix + accumulated stream`, without
   consulting the edit's epoch or attempted value.
7. **Terminal persistence:** Generation finalization may subsequently reject
   the now-stale `data` target, but that is a later server stage and does not
   undo the stream-time UI overwrite.

## Severity and likely user impact

**High.** Continue is a normal generation action, and the UI explicitly permits
editing during it. Users can see a saved edit disappear a fraction of a second
later, then see different content again after reload. Repeated frames make the
race deterministic once the edit lands before stream completion.

## Recommended fix

Give stream rendering explicit, conditional ownership:

1. Capture the target chat ID, message ID, initial `data`, chat-body projection
   epoch, and message-mutation intent epoch when the stream starts.
2. Before and after asynchronous `processScriptFull()`, verify that the target
   still has the expected stream-owned value and that neither epoch advanced.
3. Stop applying frames once an independent mutation wins. Represent pending
   stream text as a separate overlay if it still needs to be shown.
4. On conflict, cancel or detach from the generation and hydrate the
   authoritative chat rather than forcing stream text back into the row.
5. Invert the existing projection-move test: relocation should preserve the row
   only when it is still stream-owned, and a changed row should remain
   `projection final`.

## Test gap

Add a controlled-frame test that starts Continue, applies a scoped message edit
between `push()` and the scheduled flush, and asserts all later frames and
`settle()` leave the edit intact. Cover both a local mutation-intent advance and
an authoritative body-projection epoch advance.
