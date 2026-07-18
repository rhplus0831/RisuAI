# Model mutation replay discards are silent despite a contrary promise

## Summary

Saving a model profile, role bindings, or runtime defaults while offline shows
"Saved locally and queued… You do not need to submit this change again." When
the queued mutation is later discarded at replay (e.g. a compare-and-swap
conflict because another session edited the same profile), the settlement
listener silently releases the pending lane: the queued notice disappears, the
controls unfence, and the edit is gone — with no error anywhere, directly
contradicting the notice.

## Location

- `src/ts/model/modelProfileMutations.ts:167-193` — `retainPendingModelMutation`:
  the settlement listener maps `settlement === 'discarded'` (line 178) to
  `finishPendingModelMutation(token)` and nothing else; `'accepted'` correctly
  fences until projection convergence.
- Subscribers that render only pending/queued state, with no discard channel:
  `src/lib/Setting/Pages/Model/ModelProfileList.svelte:51-71`,
  `ModelProfileRoleList.svelte:51-80`, `ModelRuntimeDefaultsEditor.svelte:32-72`,
  `ModelSettingsShell.svelte:44-82`.
- `src/lang/en.ts:2498,2585` — the queued copy promising automatic retry.
- `src/ts/server/pendingMutationReplay.ts:44-47` — a global replay discard is
  only a `console.warn`.
- `server/fastify/src/commands/modelProfiles.ts:179-182` — the `expectedProfile`
  CAS that rejects a conflicting replay.
- Contrast: `src/lib/Setting/Pages/BotSettings.svelte:928-942` — the
  prompt-template toggle surfaces `replayDiscarded` on the same settlement
  signal.

## Trigger

1. Save a model profile / role bindings / runtime defaults while the server is
   unreachable → queued notice appears.
2. Reconnect; the replay hits a conflict (another session edited the same
   profile) and the outbox row is discarded.

## Expected behavior

An error like the prompt-template toggle's "The queued change could not be
applied", leaving the user aware their offline edit did not land.

## Actual behavior

The queued notice vanishes, controls unfence, and the edit silently evaporates.
The only trace is a console warning.

## Underlying cause

The retained-lane settlement wiring (added for accepted-replay fencing) treats
`'discarded'` identically to convergence: plain lane release with no error
channel back to the subscribing components.

## Affected data flow

1. Save → dispatch unavailable → `retainPendingModelMutation(token, mutationId)`
   → queued notice.
2. Reconnect → bootstrap replay → server CAS conflict → outbox discard.
3. Settlement `'discarded'` → `finishPendingModelMutation` → notice removed,
   `commandError` never set.

## Severity and likely user impact

**Medium.** Confidence: high on behavior (settlement path verified directly),
medium on intent. Offline-edited model configuration is lost without
notification, on surfaces whose own copy explicitly promises the opposite.

## Recommended fix

Extend `PendingModelMutation` with a terminal `'discarded'` phase (or a
per-lane `onDiscarded` callback) and have the four subscribers set
`commandError` to a "queued change could not be applied; the server version was
restored" message before releasing the lane — matching the prompt-template
toggle pattern.

## Test gap

A test that retains a model mutation, publishes a `'discarded'` settlement, and
asserts the subscribing surface renders an error rather than silently clearing
its pending state.
