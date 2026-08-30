# Browser-Smoke Support Boundaries

Status: ready.

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
