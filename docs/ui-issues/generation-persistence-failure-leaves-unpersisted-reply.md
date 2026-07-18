# Generation persistence failure leaves an unpersisted reply visible

## Summary

The client creates or fills an assistant row while generation tokens stream.
When durable post-generation persistence later fails, Fastify emits a terminal
error without a restoration payload. Client cleanup removes only an empty
placeholder, and the terminal error path changes the transcript only when a
restoration exists. A nonempty assistant reply can therefore remain displayed
even though Fastify rejected it and SQLite contains no such result.

## Location

- `src/ts/process/postGeneration/streamResponse.ts:106-121` appends the
  generation-owned optimistic assistant row.
- `src/ts/process/postGeneration/streamResponse.ts:164-184` fills it with
  streamed text.
- `src/ts/process/postGeneration/streamResponse.ts:187-195,235-248` removes only
  an empty generated row during cleanup.
- `src/ts/process/__tests__/streamResponse.test.ts:314-333` explicitly expects
  a nonempty row to survive a mid-stream abort for later reconciliation.
- `server/fastify/src/routes/generationChat.ts:2324-2352` can reject a stale
  generation finalization target.
- `server/fastify/src/routes/generationChat.ts:2459-2506` validates and writes
  the durable generation result.
- `server/fastify/src/routes/generationChat.ts:2771-2799` catches persistence
  failure and emits an SSE error without `restoration`.
- `src/ts/process/request/serverChat.ts:717-743` resolves the terminal error.
- `src/ts/process/serverBackedSendChat.ts:500-526` performs no transcript
  cleanup when the error has no restoration.
- `src/ts/process/index.svelte.ts:466-513` has already rendered the stream before
  awaiting the terminal acknowledgement, then returns failure without removing
  the row.

## Trigger

1. Start a durable server-backed generation and let it produce nonempty text.
2. While it runs, make a transcript mutation that makes the server's
   finalization snapshot stale, such as changing the Continue target's text or
   changing transcript length.
3. Let the mutation persist before post-generation finalization.
4. Fastify rejects the stale finalization target and emits the persistence
   error.

A terminal validation error is the clearest reproduction because it will not
later become durable through a retry.

## Expected behavior

When the terminal acknowledgement says the generated result was not persisted,
the UI must not present it as an ordinary saved assistant message. It should
remove only the generation-owned optimistic row, restore only the generation's
own Continue delta, or refresh to the authoritative server transcript while
preserving unrelated newer edits.

## Actual behavior

The nonempty streamed row stays in `chat.message`. The generation reports an
error, but the transcript visually resembles a successful completed response.
SQLite still has the pre-generation transcript plus any independent accepted
mutations. Reloading or authoritative hydration makes the assistant response
disappear.

## Underlying cause

Stream cleanup uses emptiness as its ownership/validity signal. Its comment
assumes a nonempty partial row will be reconciled by the server, but a terminal
finalization error is precisely the case where that reconciliation cannot
happen. The server's persistence-error frame contains only an error string, so
`applyServerBackedTerminal()` has no row ID, expected value, rollback delta, or
authoritative revision to apply. It intentionally does nothing unless a broad
restoration payload exists.

The provider-error restoration path is a different issue: there, a restoration
exists and is too broad. Here, no acknowledgement data exists to retract even
the generation-owned projection.

## Affected data flow

1. **UI interaction:** Send, Continue, or Regenerate starts generation.
2. **Client projection:** The stream renderer appends/reuses an assistant row
   and writes nonempty token data into it.
3. **Request:** `POST /api/v1/generate/chat` owns the durable detached job and
   later post-generation persistence.
4. **Server mutation:** `queueAndPersistGenerationFinalization()` validates the
   assembly-time target snapshot and attempts `writeGenerationChatMessage()`.
5. **Server rejection:** A stale/missing target or another terminal validation
   failure prevents the message write. The catch block emits SSE `error` without
   restoration or a generation projection disposition.
6. **Client acknowledgement:** The token stream has already settled with
   nonempty text; the terminal promise resolves as failed.
7. **Displayed state:** The terminal handler reports the error but does not
   remove or refresh the optimistic row, so the UI claims a result that the
   authoritative database rejected.

## Severity and likely user impact

**High.** This is a false-success state for the main application workflow. A
user can copy, edit, branch from, or otherwise rely on a reply that will vanish
on reload. It can also make subsequent UI actions target a message ID that does
not exist server-side, producing follow-on 404/conflict behavior.

## Recommended fix

Make the terminal protocol explicitly settle the generation projection:

1. Track the generated row's stable ID, pre-generation value, and last
   generation-owned value on the client.
2. Include a terminal disposition such as `persisted`, `retrying`, `rejected`,
   or `cancelled`, plus the authoritative chat revision/target identity.
3. On a terminal rejection, conditionally remove the generated row or restore
   the Continue target only if it still equals the generation-owned value. If
   another mutation changed it, hydrate instead of overwriting it.
4. For retryable persistence, mark the row visibly pending and reconcile it
   from job status; do not present it as durable before acknowledgement.
5. Use a forced authoritative chat-body refresh as the fallback when a narrow
   cleanup cannot be proven safe.

## Test gap

Add a durable generation integration test that emits tokens, changes the target
so finalization throws `ValidationError`, and asserts that the client does not
retain the generated row after the terminal error. Also cover a newer user edit
to the optimistic row and verify cleanup does not overwrite that newer value.

