# Transcript invalidation can clobber an optimistic message mutation before its retained projection registers

## Summary

A message edit/delete applies its optimistic transcript write synchronously at
dispatch, but the retained chat-body projection that protects it from
authoritative applies is registered only inside the transport callback — after
the origin-wide command queue grants the slot, and only for durable mutations.
Optimistic writes do not advance the chat-body projection epoch that the
invalidation path checks, so an invalidation for the same chat landing in that
window replaces the transcript with a pre-edit body: the user's edit visually
reverts, reappearing only after the edit's own acknowledgement fails epoch
validation and forces an authoritative re-read.

## Location

- `src/ts/chatCommands.ts:5300-5333` — the optimistic transcript patch is
  applied synchronously at dispatch.
- `src/ts/chatCommands.ts:800-838` — `bindDurableChatProjectionAttempt`
  registers the retained chat-body projection only inside the transport
  callback (after the queue slot), and only when `transport.mutationId`
  exists.
- `src/ts/server/resourceState.svelte.ts:62-92` — chat-body projection epochs
  advance only on applies/acknowledgements, never on optimistic writes.
- `src/ts/server/resourceInvalidation.ts:962-999,1143-1160` — the supersession
  check and apply for targeted body reads.
- `src/ts/server/chatMessageHydration.svelte.ts:564-591` —
  `applyServerChatMessagesResource` replaces the transcript.

## Trigger

The user edits or deletes a message (optimistic write applied immediately;
dispatch enqueued behind the origin-wide command queue — potentially seconds
behind a long-running earlier command). Before the transport callback runs, an
invalidation for the same chat (foreign `message`/`chatTranscript`/`generation`
event — e.g. a translation job completing or a durable server-side generation
persisting) fetches and applies the transcript. The captured chat-body epoch is
unchanged, so the supersession snapshot does not mark the read stale.

## Expected behavior

The optimistic edit stays visible through the authoritative apply — as it does
once the retained projection is registered (`reapplyRetainedChatBodyProjections`
reapplies it).

## Actual behavior

The fetched transcript (predating the edit) replaces the chat body; the edit
visually reverts. It reappears when the edit's own acknowledgement fails its
epoch validation and falls back to an authoritative re-read. The same clobber
occurs with *no* reapply on non-durable paths (`transport.mutationId` absent)
and the legacy non-scoped variants (`dispatchDeleteMessage`).

## Underlying cause

The anti-clobber fence for in-flight optimistic transcript mutations is the
retained projection, but it is armed asynchronously (queue slot + outbox
readiness) after the optimistic write, and optimistic writes do not advance
the epoch the invalidation path checks.

## Affected data flow

1. **UI:** edit → optimistic transcript write.
2. **Window:** command queued; retained projection not yet registered.
3. **SSE:** chat invalidation → transcript read → epoch unchanged → apply.
4. **Displayed state:** edit reverts.
5. **Recovery:** own ack fails epoch validation → authoritative re-read →
   edit restored.

## Severity and likely user impact

**Low** (medium confidence; transient and self-healing, but the window grows
when the command queue is congested). The visible flip-flop matches the
reported "updated value appears after a delay and then reverts" symptom class.

## Recommended fix

Register the retained projection synchronously when the attempt is registered
(`registerScopedTranscriptAttempt`), releasing it if dispatch never becomes
durable. Alternatively, advance a chat-body "intent" epoch
(`markChatMessageMutationIntent` already exists) and include it in
`snapshotTargetedBodyReadSupersessions`.

## Test gap

Interleaving test: apply an optimistic scoped edit, apply an authoritative
transcript read captured before the edit while the transport callback is still
pending, and assert the edit remains visible.
