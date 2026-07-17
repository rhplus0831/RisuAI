# Message edit retains an invalidated raw translation

## Summary

Editing the source text of a message that already has a server-generated raw translation produces different canonical state in the browser and Fastify. Fastify correctly clears the translation because its `sourceHash` no longer matches the edited text, but the optimistic client changes only `message.data`. The accepted response carries no canonical message row, so the browser can continue displaying the old translation over the newly edited source until a later transcript hydration or reload.

## Location

- `src/lib/ChatScreens/Chat.svelte:843-855,963-1034,1118-1121,2041-2066`
- `src/ts/chatCommands.ts:4578-4611,4649-4662`
- `src/ts/server/commands.ts:4854-4872,7713-7770`
- `src/ts/bootstrap.ts:1445-1462`
- `src/ts/server/chatMessageHydration.svelte.ts:611-624`
- `server/fastify/src/messageStore.ts:189-215,292-307`
- `server/fastify/src/routes/commands.ts:5868-5922`
- `server/fastify/__tests__/commands.test.ts:9631-9738`

## Trigger

1. Translate a resident message through the Fastify raw-translation endpoint.
2. Leave the row in translated mode, or toggle back to the source while retaining the stored translation.
3. Edit the message text through the normal editor or partial-edit action and save it.

## Expected behavior

Changing the source text should invalidate the old raw translation in both persistence and the resident UI. The row should immediately show the edited source and the next Translate action should request a fresh translation.

## Actual behavior

Fastify persists the edited text with `translation: null`, but the browser retains the previous translation object. If translated mode was already active, the old translated text can continue to cover the newly edited source immediately after Save. If it was inactive, clicking Translate later can reactivate the cached stale text without sending a translation request. A subsequent authoritative transcript hydration makes the translation disappear, so the UI can appear to correct itself only after navigation or reload.

## Underlying cause

Both edit paths send only `{ data }`. `dispatchUpdateMessageScoped()` optimistically applies exactly those supplied fields and records that transcript as the accepted local projection.

The server applies a stronger invariant. `toRow()` calls `normalizeMessageTranslationForData()`, which compares a raw translation's `sourceHash` with the hash of the resulting message data and writes `translation: null` on a mismatch. The existing Fastify regression test explicitly verifies this behavior.

The PATCH response contains only revision/event identifiers, not the canonical message. Its client local effect likewise contains only message/chat identifiers and a projection epoch. `acknowledgeMessageMutationLocalEffect()` advances that epoch because it assumes the row contents were already applied by the caller; it cannot apply Fastify's additional `translation: null` normalization.

Finally, `activeRawTranslation()` checks only `source === 'raw'` and that translated text exists. It never verifies `sourceHash` against the current `message.data`, so the stale client object remains eligible for display and reuse.

## Affected data flow

1. **UI action:** The full editor calls `edit()` and the partial editor calls `handlePartialEditSave()` (`Chat.svelte:963-1034`).
2. **Client projection:** Both paths invoke `dispatchUpdateMessageScoped(messageId, { data }, previous)`. The dispatcher clones the transcript and patches only `data` (`chatCommands.ts:4578-4611,4649-4662`).
3. **Request:** `updateMessageCommand()` sends `PATCH /api/v1/commands/messages/:messageId` with the data-only patch (`commands.ts:4854-4872`).
4. **Server persistence:** Fastify merges the patch into the stored row, detects that the raw translation hash no longer matches, and persists `translation: null` (`messageStore.ts:189-215,292-307`).
5. **Response:** The route returns revision, event, `chatId`, and `messageId`, but no canonical message or translation field (`routes/commands.ts:5914-5918`).
6. **Client acknowledgement:** The bootstrap command effect validates the optimistic projection epoch and only advances it (`bootstrap.ts:1445-1462`; `chatMessageHydration.svelte.ts:611-624`). This also fences an older hydration from replacing the optimistic row without reconciling the server-only normalization.
7. **Display:** `displayMessage` selects `activeRawTranslation().text` whenever local `translated` is true, and the Translate button reuses any such object without a request (`Chat.svelte:1118-1121,2041-2066`).

## Severity and user impact

**High.** The open transcript can display text that is neither the user's edit nor the canonical server value. Users can believe an edit failed, copy or inspect an obsolete translation, or unknowingly read different content from what generation and persistence use. The divergence survives successful acknowledgement and can be present until an unrelated hydration.

## Recommended fix

- When a message data edit changes the source, optimistically clear its raw translation and translated/edit-translation UI state in the same fenced mutation. Include `translation: null` in the PATCH if the client owns this invariant.
- Prefer returning the canonical updated message (or at least normalized fields such as `translation`) from the message PATCH and applying it through an attempt- and owner-fenced local effect. This keeps future server-side normalization from producing the same class of divergence.
- Make `activeRawTranslation()` independently validate `sourceHash` against the current source data, treating a mismatch as absent even before reconciliation.
- Apply the same rule to full-message replacement paths, which Fastify also normalizes.

## Test coverage gap

The Fastify test proves that persistence clears the translation, but there is no client integration test for the resulting response. Add a `Chat`/command test that starts with translated mode active, saves changed source text, acknowledges the data-only PATCH, and asserts that the edited source is displayed, the resident translation is null, and the next Translate click sends a new request. Cover partial edit and a stale hydration racing the acknowledgement.
