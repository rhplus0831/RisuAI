# Slice: Server Projection Reconnect Backoff

Phase: [6](../../phase-6-bridges-lifecycle-network.md). Finding: L45.
Runtime change.

## Scope

Replace the fixed 1 second command-event reconnect delay with capped
exponential backoff plus jitter, resetting on successful subscription.

This slice owns the client SSE reconnect scheduler in `src/ts/bootstrap.ts`.
It does not own server event retention, replay query cost, full-bootstrap
resync breadth, or memory-event protocol changes.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L45.
- `src/ts/bootstrap.ts`: `SERVER_PROJECTION_RECONNECT_DELAY_MS`,
  `startServerProjectionEvents`, `scheduleServerProjectionReconnect`,
  `stopServerProjectionEvents`, `replay-unavailable` handling.
- `src/ts/server/events.ts`: `subscribeServerCommandEvents` status contract.
- `src/ts/server/projectionResync.ts`: `forceServerProjectionResync`.
- Existing focused suite: `src/ts/bootstrap.test.ts`.

## Target Shape

- Track reconnect attempt count or current delay in module state beside
  `serverProjectionReconnectTimer`.
- Compute delays from a 1 second base to a cap around 30 seconds, with jitter
  so multiple clients do not reconnect in lockstep.
- Keep the one-timer invariant: while a reconnect timer is pending, additional
  `onError`/`onClose` calls must not schedule duplicates.
- Reset the backoff state after `subscribeServerCommandEvents` returns
  `{ status: 'ok' }`.
- Preserve `replay-unavailable` semantics: run the read-only resync, then
  schedule a reconnect through the same bounded backoff path.
- Clear timer and backoff state in `stopServerProjectionEvents()` so a later
  deliberate start begins from the base delay.
- Factor the delay calculator into a small testable helper or make tests stub
  `Math.random` and fake timers. The first outage retry should be near 1
  second; repeated failures should grow and cap; success should reset the next
  failure to the base delay.
- Register L45 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- No reconnect is scheduled when `serverProjectionEventsDesired` is false.
- Existing subscription teardown still runs before a new subscribe attempt.
- Own-event skip, gap detection, and targeted projection application are
  unchanged.
- Jitter must not produce negative, zero, `NaN`, or above-cap delays.

## Done Criteria

- A simulated outage schedules increasing reconnect delays and caps them around
  30 seconds.
- Multiple close/error notifications before the timer fires still result in one
  pending timer.
- A successful subscription resets the next reconnect delay to the base window.
- `replay-unavailable` still triggers full resync before scheduling reconnect.
- L45 v2 gate entry points at a real focused test and the risk-map row is
  `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/events.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
