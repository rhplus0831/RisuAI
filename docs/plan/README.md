# Active Plans

Active multi-phase workstreams live here while implementation is in progress.
The codebase and current architecture guides remain the source of truth for
shipped behavior. Completed workstreams move to `.archived-docs/` with their
plan, status, phase, slice, decision, and verification structure intact.

## Workstreams

- [Frontend Test Architecture](frontend-test-architecture/status.md) — classify
  frontend tests by required runtime, move non-DOM behavior out of Happy-DOM,
  extract pure logic where measured import graphs justify it, and preserve
  explicit rendered-DOM and browser contracts.
