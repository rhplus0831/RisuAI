# Iris reset can be overwritten by late dialogue hydration

## Summary

Iris allows the backlog to be reset before its device-local dialogue has finished loading. Reset writes the intro dialogue to localforage, but the earlier `getItem()` completion is applied unconditionally afterward. A slow hydration can therefore restore the old conversation over the newer reset in the UI, leaving the displayed dialogue and persisted dialogue inconsistent.

## Location

- `src/lib/Others/IrisModal.svelte:86-120`
- `src/lib/Others/IrisModal.svelte:190-212,299-310`
- `src/lib/Others/IrisModal.svelte:426-455,484-490`
- `src/lib/Others/IrisModal.svelte:522-597,653-676`
- `src/lib/Others/IrisModal.svelte.test.ts:89-98,294-320`

## Trigger

1. Open Iris when `localforage.getItem('current_dialogue')` is slow, such as on a busy device or with a cold IndexedDB connection.
2. Before hydration settles, click **Log** and then **Reset**.
3. Allow the original `getItem()` to resolve with the previously saved conversation.

## Expected behavior

The reset is the newer user intent and should win. Iris should continue to show the localized intro dialogue, and `current_dialogue` should contain the same reset value.

## Actual behavior

`resetDialogue()` immediately shows and saves the intro. The pending hydration callback can then replace `dialogue` with the old saved conversation, move `currentIndex` to its last line, and restart typing that old line. The earlier reset write may still be the value stored in localforage, so closing and reopening Iris can make the conversation change back to the intro again.

## Underlying cause

Hydration is guarded only by a component-level `mounted` boolean. It has no request epoch or local-edit revision. `resetDialogue()` does not mark the pending read stale, and the reset button is available even while `dialogueHydrated` is false. `dialogueHydrated` gates the message composer, but not the Log or Reset controls.

The read is issued before the reset write. A localforage backend can therefore complete that older read with the pre-reset value. Its `.then()` unconditionally assigns `dialogue` and `currentIndex`, regardless of the newer reset and `setItem()` call.

## Affected data flow

1. **Initial UI state:** Iris renders the localized intro and starts `getItem('current_dialogue')` on mount (`IrisModal.svelte:91-120,426-450`).
2. **UI action:** The always-available Log button opens the backlog and exposes Reset (`IrisModal.svelte:522-597`).
3. **Client projection:** Reset assigns the intro to `dialogue`, resets the index, and starts typing it (`IrisModal.svelte:484-490`).
4. **Persistence request:** `saveDialogue()` sends a cloned intro dialogue to localforage with `setItem('current_dialogue', ...)` (`IrisModal.svelte:208-212`). This data is intentionally device-local; there is no Fastify request in this flow.
5. **Stale response:** The older `getItem()` resolves with the previous dialogue and overwrites the newer client projection (`IrisModal.svelte:429-441`). The `mounted` check still passes.
6. **Display:** The dialogue box and backlog derive directly from the overwritten `dialogue`/`currentIndex`, while localforage may already contain the reset value.

## Severity and user impact

**Medium.** The race window is short on fast storage but deterministic with delayed hydration. Reset can appear to fail, an old conversation the user intended to clear can reappear, and the UI may disagree with device persistence until the modal is reopened.

## Recommended fix

Track a dialogue revision before starting hydration and discard the result if any local mutation occurred. Reset should increment that revision before assigning or saving. A simpler additional safeguard is to disable Log/Reset until `dialogueHydrated` is true, but the revision check should remain to protect future pre-hydration actions. Serialize or version localforage writes as well so later dialogue snapshots cannot be committed out of order.

## Test coverage gap

The existing hydration test verifies that message submission waits for restoration (`IrisModal.svelte.test.ts:294-320`), but Reset is not gated by the same condition. Add a test with a deferred `forageGetItem`, click Log and Reset before resolving it, then resolve the old dialogue and assert that the intro remains both displayed and last persisted.
