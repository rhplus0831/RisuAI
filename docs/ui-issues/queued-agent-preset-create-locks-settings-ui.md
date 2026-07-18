# Queued agent-preset create locks the settings UI for the rest of the session

## Summary

Creating or duplicating an agent preset (or creating/duplicating a step) while
the server is unreachable stages the intent durably and reports "Command
queued" — but nothing replays the outbox in-session. The generated-projection
latch that disables the whole Agent Presets surface can only be released when
the created row appears in the database, which requires a replay that only
runs at bootstrap. One offline click therefore disables agent-preset
management until a full page reload, with no recovery hint.

## Location

- `src/ts/agentPresets.ts:504-540` — generated-mutation latch registration;
  `:816-850` — unlock predicate waits for the created row to be observed;
  `:492-501` — all other agent-preset mutations are blocked while a generated
  submission is unresolved.
- `src/lib/Setting/Pages/AgentPresetSettings.svelte:36-52` —
  `mutationLocked = busy || queuedProjectionLatch !== null`; every control is
  `disabled={mutationLocked}`.
- `src/ts/bootstrap.ts:258` and `src/ts/server/pendingMutationReplay.ts:16` —
  outbox replay runs only during bootstrap.
- `src/ts/process/reattach.ts:221` — the `'online'` listener reattaches
  generation jobs only; it does not replay the outbox.
- `src/ts/server/durableMutationDispatch.ts:400-431` — retained settlement
  path that produces the `queued` outcome.

## Trigger

1. Open Settings → Agent Presets while the server is unreachable (or during a
   transient 5xx window).
2. Click Create/Duplicate preset, or Save Step (new)/Duplicate step.
3. Restore connectivity and continue using the app without reloading.

## Expected behavior

"Command queued", then automatic persistence when connectivity returns, and
the page becomes usable again.

## Actual behavior

The intent is durably staged, but no in-session replay exists. Predecessor
draining would only happen when a successor agent-preset mutation dispatches —
which the latch-driven `mutationLocked` prevents from this UI. The unlock
condition (matching created row appears) can never fire in this tab. The whole
surface stays disabled behind "Command queued" until reload; after reload the
bootstrap replay persists the row correctly, so "queued forever" in-session
masks an eventually-successful write.

## Underlying cause

The latch's release depends on observing the materialized row, but the only
mechanism that can materialize it (outbox replay) never runs between
bootstraps, and the lock itself prevents the alternative trigger (a successor
dispatch draining predecessors).

## Related sharp edges

- `src/ts/agentPresets.ts:485-502,510-517` — a mutation dispatched while a
  generated submission is unresolved rolls back the optimistic write, never
  stages the intent, and still returns `status: 'queued'`; callers
  (`AgentPresetSettings.svelte:141-160`,
  `AgentPresetEditorDrawer.svelte:577-596`) treat `queued` as success and
  close the editor. Today this path is fenced off by `mutationLocked`, but it
  conflates "dropped" with "queued" for any future caller.
- The unlock predicate requires an exact name+semantic-descriptor match, so a
  cross-tab drain that materializes a row whose server-minted `outputKey`
  differs from the client prediction (`agentPresets.ts:794-807` vs the
  server's `uniqueOutputKey`) also leaves the latch permanently unresolved.

## Affected data flow

1. **UI:** Create/Duplicate → `dispatchGeneratedAgentPresetMutation` (latch
   set).
2. **Client state:** optimistic row + durable outbox stage.
3. **Request:** send fails non-terminally → settlement `retained` → outcome
   `queued`.
4. **Displayed state:** "Command queued" banner; every control disabled.
5. **Missing step:** no in-session replay → row never materializes → latch
   never releases.

## Severity and likely user impact

**Medium.** A single offline action bricks the agent-preset surface for the
session; the "queued" message never resolves even though the write will land
at next reload. Mechanics verified with high confidence; whether the permanent
lock is accepted design is medium.

## Recommended fix

Replay the pending-mutation outbox on reconnect (`'online'` event and/or SSE
reconnection) or drain the retained lane on a timer; alternatively, surface
"reload to finish syncing" on the latch banner. Separately, make the blocked
dispatch path return a distinct `blocked` status instead of `queued` so the
editor does not close over a discarded edit.

## Test gap

A test that queues a generated create (offline transport), then restores the
transport and asserts the latch releases without a bootstrap; plus a test that
a mutation attempted while latched is not reported as `queued` when it was
dropped.
