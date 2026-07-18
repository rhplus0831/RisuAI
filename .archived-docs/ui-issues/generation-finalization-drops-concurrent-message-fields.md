# Generation finalization drops concurrent message fields

## Summary

Continue and Regenerate validate their target using only transcript length plus
the message's stable ID, role, and `data`. After that check, generation
finalization writes a complete replacement message record. A concurrent
message command that changes an orthogonal field such as `disabled`,
`translation`, `name`, or `isComment` leaves ID/role/data unchanged, so the
freshness check passes and the accepted field is silently discarded from
SQLite by the later generation write.

This is a server terminal-persistence race affecting full-row fields. It is
separate from stream frames overwriting `data` in the browser before terminal
finalization.

## Location

- `src/lib/ChatScreens/Chats.svelte:177-180` marks only an empty final row as
  generation-loading, so actions remain available on Continue/Regenerate
  targets.
- `src/lib/ChatScreens/Chat.svelte:2089-2147,2246-2319` exposes translation,
  edit, Disable Message, and Disable Above actions without a generation-owner
  guard.
- `src/ts/chatCommands.ts:149-160` permits message patches for `translation`,
  `name`, `time`, `disabled`, `isComment`, and other row fields.
- `src/ts/chatCommands.ts:4835-4869` dispatches the scoped durable patch.
- `server/fastify/src/routes/commands.ts:6235-6303` persists the targeted
  message patch.
- `server/fastify/src/routes/generationChat.ts:443-460,1500-1545` captures a
  finalization snapshot containing only role, data, and optional message ID.
- `server/fastify/src/routes/generationChat.ts:2296-2305,2324-2352` compares only
  those fields and transcript length when deciding target freshness.
- `server/fastify/src/routes/generationChat.ts:2459-2506` creates a full message
  record from the generation result and calls `writeGenerationChatMessage()`.
- `server/fastify/src/messageStore.ts:357-396` replaces `uid`, `role`, `data`,
  `disabled`, and the entire JSON payload for the existing row.
- `src/ts/process/serverBackedSendChat.ts:553-603` mirrors the durable terminal
  message patch into the UI after persistence.

## Trigger

1. Start Continue or Regenerate for an existing assistant message.
2. While generation is running, toggle **Disable Message** or **Disable Above**
   on that target. Alternatively, save a translation/name/other orthogonal
   field through a second mounted view or tab.
3. Let the message `PATCH` finish before generation finalization.
4. Let generation complete successfully.

The Disable action is a direct reproduction because it changes a stored column
but not the snapshot's ID, role, or text.

## Expected behavior

An accepted concurrent patch must either be preserved when the generation
updates its owned fields or cause an explicit finalization conflict. Generation
may replace response text and generation metadata, but it must not silently
erase a field it neither snapshotted nor owns.

## Actual behavior

The independent message command updates SQLite and reports success. At terminal
finalization, `rowMatchesSnapshot()` still returns true because `disabled` and
the other JSON fields are ignored. `writeGenerationChatMessage()` then performs
a full SQL/JSON replacement using the assembly/post-generation message object,
which does not contain the newer patch. The accepted value is lost in the
authoritative database, and the terminal message projection makes the UI revert
to match that loss.

For example, a row changed to `disabled: true` can be written back as
`disabled: false` while keeping the same ID/role/data check satisfied. This is
not merely a stale display: the newer durable state is overwritten.

## Underlying cause

The finalization protocol uses a partial freshness predicate followed by a
full-record write. The fields guarded by the compare operation are narrower
than the fields mutated by the operation. There is no message-row version,
complete-record digest, expected JSON value, or merge against the live row.

Client retained-projection and inlay guards cannot prevent this loss. Those
mechanisms protect pending client projections and delayed client-side inlay
settlement; the overwrite occurs authoritatively inside the Fastify transaction
after the orthogonal command already succeeded.

## Affected data flow

1. **UI interaction:** While Continue/Regenerate runs, the user changes
   `disabled` or another non-text field on its target row.
2. **Client projection:** `dispatchUpdateMessageScoped()` paints/registers the
   field-level optimistic attempt.
3. **Request:** `PATCH /api/v1/commands/messages/:messageId` sends the
   orthogonal field patch.
4. **Server persistence:** Fastify updates that field in the live message row
   and returns a new revision plus `message.updated` event.
5. **Generation acknowledgement:** The detached generation reaches
   post-generation with a snapshot containing only the old ID/role/data tuple.
6. **Server finalization:** Freshness validation ignores the changed field,
   then `writeGenerationChatMessage()` replaces the whole row/JSON using the
   generated message record.
7. **Displayed state:** The terminal message patch or subsequent hydration
   paints the replacement record, making the successfully saved field revert
   everywhere because SQLite now also contains the old/default value.

## Severity and likely user impact

**High.** This is acknowledged data loss: the UI/server can confirm a message
action and then silently erase it on successful generation. Disable controls
affect future prompt composition, while translation/name/comment metadata affect
what users read and manage. Cross-tab timing makes the loss difficult to
diagnose because every individual request can report success.

## Recommended fix

Align the compare set with the write set:

1. Prefer a message-row version or full normalized-record digest in
   `GenerationFinalizationTargetSnapshot`; reject/rebase when any field changed
   after assembly.
2. Better, make generation finalization a field-level merge onto the current
   live row. Update only generation-owned fields (`data`, generation/prompt
   metadata, IDs where Regenerate intentionally creates a new candidate) and
   preserve unrelated fields that changed concurrently.
3. Define explicit semantics for fields such as translation when response text
   changes. If they must be invalidated, make that an intentional, conditional
   mutation and report the conflict rather than inheriting omission from a
   replacement object.
4. Include message field/version information in the terminal event so the
   client can reconcile the same merge deterministically.
5. Optionally disable target-row controls while generation owns the row, but do
   not rely on UI gating for cross-tab correctness.

## Test gap

Add a Fastify concurrency test that captures a Continue/Regenerate snapshot,
persists `{ disabled: true }` or a translation patch, and then finalizes the
generation. Assert either an explicit conflict or a merged final row that
retains the field. Verify both the SQLite columns/JSON and the terminal message
payload. Keep a separate stream test for concurrent `data` writes so the two
stages cannot regress under one broad test.
