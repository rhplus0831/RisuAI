# Character memory and input-translation toggles hide persistence outcomes

## Summary

The sidebar's Hypa memory and input-translation-hook controls call character
helpers that return raw `Promise<ServerCommandResult>` values, but their
handlers discard those Promises. The checkboxes optimistically reflect the new
character fields while Fastify persistence is unresolved, with no accepted,
queued, or failed state. Moreover, the durable layer's retain-versus-rollback
disposition is private, so the raw result is not sufficient for the component
to classify every non-success response correctly.

Attempt chains are field-scoped and stale-failure-safe. A terminal rejection
therefore flips only the still-current failed toggle back; a retained failure
keeps the exact optimistic flag for replay. Both transitions are silent in the
UI.

## Location

- `src/lib/SideBars/Toggles.svelte:92-100,293-305,332-342` invokes both
  character setters without awaiting their results.
- `src/ts/characterCommands.ts:1135-1197` dispatches field-scoped durable
  patches and guarded rollback.
- `src/ts/characterCommands.ts:2033-2065` optimistically updates the row and
  returns the server-result Promise.
- `src/ts/characterCommands.test.ts:2244-2397` covers retained and rapid
  input-translation attempts; `src/ts/characterCommands.test.ts:2482-2527`
  demonstrates terminal Hypa-memory rollback.
- `src/ts/server/commands.ts:3358-3372` sends the character PATCH.
- `server/fastify/src/routes/commands.ts:5076-5131` validates and persists the
  character row.

## Trigger

1. Toggle “Hypa Memory” or “Use Input Translation Hook” in the sidebar.
2. Let `PATCH /characters/:characterId` be retained after a retryable failure or
   fail terminally.
3. Optionally toggle the same field again before the first response to exercise
   the existing successor rebasing.

## Expected behavior

Each checkbox should expose the exact mutation classification. Accepted work
can settle, retained work should show queued, and terminal failure should show
an error while the guarded rollback updates the checkbox. Rapid toggles should
report status for the latest intent without blocking unrelated character
fields.

## Actual behavior

`setCharacterSupaMemory` and `setCharacterInputTranslationHook` synchronously
change the selected character field and return the Promise from a durable
character patch. `Toggles.svelte` wraps each call in a `void` handler and does
not store or await the result.

On terminal failure, field-attempt guards restore the prior value only when the
live field still equals the failed attempt and rebase later attempts. The bound
checkbox consequently reverts with no message. On a retryable failure, the
outbox retains and reasserts the optimistic flag; the checkbox looks accepted
even though the server has not applied it.

## Underlying cause

There are two contract gaps. The sidebar handlers retained the former
synchronous `Database` setter call shape and discard the returned command
Promise. Even if they awaited it, the public character helper exposes only the
raw `ServerCommandResult`; the durable dispatcher keeps its exact retained or
rolled-back disposition inside `PendingCharacterMutationExecution`. The UI
therefore has neither settlement handling nor enough public information to
classify every non-`ok` response.

## Affected data flow

1. **UI interaction:** `CheckInput` calls `setSupaMemoryValue` or
   `setInputTranslationHookValue` for the currently rendered stable `chaId`.
2. **Client projection:** the helper snapshots the target scalar, changes
   `character.supaMemory` or `character.useInputTranslationHook`, and registers
   a per-character/field mutation attempt.
3. **Request:** the durable owner sends
   `PATCH /api/v1/commands/characters/:characterId` with `baseRevision` and the
   one-field patch.
4. **Server persistence:** Fastify validates the allowed character patch,
   applies it to the exact collection row, and persists it with
   `writeSingleCharacterRow()`.
5. **Response/acknowledgement:** success returns a revision,
   `character.updated`, and character ID; the local effect acknowledges that
   attempted scalar. Retryable failure retains the outbox; terminal failure
   invokes the field-scoped rollback and successor rebase.
6. **Displayed state:** the checkbox reads `chara` from the shared character
   resource, so it eventually reflects retained, accepted, or restored state,
   but the handler cannot tell the user which occurred.

## Severity and likely user impact

**Medium.** Both flags change generation preprocessing or memory behavior, so a
user can believe a behavior is enabled when it is only queued, or see it switch
off after a rejected save with no explanation. The data itself is protected by
narrow rollback, but the configuration acknowledgement is misleading.

## Recommended fix

- First expose an outcome-bearing character mutation API that combines the raw
  server result with the durable disposition as `accepted | queued | failed`.
  Do not infer queued versus rolled back from `result.ok` alone.
- Await that outcome in `Toggles.svelte` and render its exact classification.
- Track pending state by `(characterId, field)` and disable or debounce only the
  affected checkbox when appropriate.
- Keep the optimistic value for queued mutations and show a localized queued
  indicator; show a localized error after terminal rollback.
- Preserve current field-attempt and successor-rebase logic so an older failure
  cannot overwrite a later toggle.
- Add component tests for accepted, retained, terminal, and rapid double-toggle
  cases.
