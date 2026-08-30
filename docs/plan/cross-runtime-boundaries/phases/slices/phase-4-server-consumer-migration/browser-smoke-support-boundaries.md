# Browser-Smoke Support Boundaries

Status: complete at `85b01059c` with count-gate follow-up `589d7a893`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move browser-smoke-only hook, display fixture, and startup snapshot dependencies
to neutral contracts or test-owned fixtures without changing browser behavior.

## Boundary And Contract

Audit only the hook declaration, lazy-first-open English labels, and startup
readiness snapshot types. Preserve hook shape, exact displayed text, startup
state fields, and smoke assertions through source parity where test-owned
fixtures replace application imports. Router and resource-manifest behavior
remain outside this slice.

## Verification

Run exact affected browser-smoke files, focused parity/ownership proof, both
typechecks, architecture inventory, formatting, and diff checks.

## Result

- Startup readiness snapshot types moved into the existing protocol startup
  telemetry owner.
- The lazy-first-open English labels use a browser-smoke-owned fixture with
  exact source parity.
- The global hook declaration remains the one intentional smoke-support edge;
  router and resource-manifest behavior remain intentional integration edges.
- The focused ownership suite passed 2 tests, and the checked browser-smoke lane
  dropped from six edges to three without changing the 9-scenario smoke run.
