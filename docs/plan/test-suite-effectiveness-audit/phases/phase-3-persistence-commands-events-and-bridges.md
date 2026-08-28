# Phase 3: Persistence, Commands, Events, And Editing Bridges

Status: Pending; depends on Phases 0-2.

## Objective

Audit whether storage, revisioned commands, event delivery, and optimistic
editing tests prevent data loss, wrong-target mutation, duplicate application,
secret loss, and overbroad rollback.

## Scope

- Database initialization, defaults, migrations, legacy import, and repository
  round trips.
- Command revisions, receipts, idempotency, concurrency, mutation ranges,
  targeted paths, and event ordering/delivery.
- Message/Hypa physical storage, alternates, identity repair, and narrow
  read/write cost contracts.
- Browser command adapters and entity editing bridges for characters, chats,
  settings, presets, personas, loadouts, modules, lorebooks, and scripts.
- Dirty-field preservation, stable IDs, dependency ordering, rollback rebasing,
  lifecycle flush, and accepted/queued/failed UI projection.

Primary discovery guides:

- [`persistence-commands-and-events.md`](../../../tests/persistence-commands-and-events.md)
- [`domain-mutations-and-editing-bridges.md`](../../../tests/domain-mutations-and-editing-bridges.md)

## Audit Questions

- Do assertions reach exact SQLite rows, revisions, events, and visible rollback
  where the risk requires them?
- Are idempotency, stale writers, concurrent siblings, stable target identity,
  and partial success proved rather than implied by mocks?
- Do implementation-aware bridge tests enforce a deliberate state machine, or
  merely duplicate current implementation details?
- Are narrow read/write budgets paired with correctness and not treated as
  behavior substitutes?
- Can repeated mutation/focus/race matrices share harnesses without losing
  entity-specific ownership?

## Required Outputs

- Per-command and per-bridge protected-contract map.
- Storage/API/browser companion evidence and intentional overlap notes.
- Findings for obsolete resource shapes, source-string assertions, duplicate
  matrices, missing physical-row proof, broad rollback, and missing race cases.
- Removal/consolidation proof for any scenario or helper retired.

## Exit Criteria

- Every Phase 3 test and shared persistence helper has a disposition.
- Transcript, identity, revision, receipt, transaction, and rollback invariants
  retain unique regression proof.
- Critical/High data-integrity findings are resolved or gated with explicit
  ownership.
- Load-cost gates remain isolated and meaningful.
- Count deltas, retained defense in depth, and residual gaps are recorded.

## Validation

- Focused frontend bridge and Fastify persistence/command tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:server`
- Relevant browser recovery/reroll specs when the visible durable loop changes
- Isolated load-cost tests with documented worker limits
- `pnpm format:check`
- `git diff --check`
