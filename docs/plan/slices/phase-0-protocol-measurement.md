# Phase 0: Protocol Measurement

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-0-protocol-measurement)

Status: planning slice.

Goal: make the existing pressure points visible before changing behavior.

## Implementation Slices

### 0.1 Server Protocol Metrics

- Add structured server logs or an internal metrics helper for command mutation
  total duration and major sections: load, clone/mutate, SQLite sync,
  `db.json` write, and event emit.
- Add bootstrap and projection payload size measurement.
- Add `/api/v1/events` replay measurement for replay success, replay miss,
  oldest retained revision, requested revision, and current revision.
- Add generation result persistence measurement for success, raw-fallback
  warning, and terminal persist error.
- Add Realm import staged asset count and total staged bytes.

Done when command, projection, event, generation, and Realm import pressure
points can be observed without changing protocol behavior.

### 0.2 Client Protocol Diagnostics

- Add client-side counters or guarded debug logs for full bootstrap resync
  reason: replay unavailable, revision gap, projection full mode, projection
  error, or no baseline.
- Track bulk hydration count and maximum concurrent requests.
- Track chat/lorebook hydration stale-response drops.

Done when a manual reconnect can distinguish normal event replay from each full
bootstrap fallback reason.

### 0.3 Low-Overhead Guardrails

- Keep instrumentation optional and low overhead.
- Prefer existing server logger paths.
- Prefer guarded client debug output over always-on console noise.

Done when the metrics remain cheap during normal operation and can be enabled
for diagnosis.

### 0.4 Validation Readout

- Document the manual readout needed to confirm reconnect replay versus full
  bootstrap fallback.
- Confirm command latency can be attributed to load/clone, SQLite sync, and
  `db.json` write time.

Done when the phase has both automated test coverage and one repeatable manual
diagnostic flow.

## Acceptance

- Existing tests still pass.
- A manual run can distinguish normal reconnect replay from full bootstrap
  fallback.
- Command latency can be attributed to at least load/clone, SQLite sync, and
  `db.json` write time.

## Validation

- `pnpm api:test`
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/chatMessageHydration.test.ts`
