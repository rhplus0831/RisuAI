# Client Resource Ownership Phase Guide

The phase files translate [`PLAN.md`](../PLAN.md) into bounded outcomes.
[`status.md`](../status.md) owns live consumer counts and per-family dependency
cursors.

## Execution Order

Phase 0 freezes and gates compatibility consumers. Phase 1 fills owner API gaps.
Phases 2-5 migrate resource families only as Workstreams 1 and 2 release them.
Phase 6 removes shared facade/bridge infrastructure after all consumer counts
reach zero. Phase 7 decides temporary seams, measures the result, verifies, and
archives.

## Phase Index

- [Phase 0: Consumer, facade, and bridge inventory](phase-0-consumer-facade-and-bridge-inventory.md)
- [Phase 1: Resource-owner foundation](phase-1-resource-owner-foundation.md)
- [Phase 2: Leaf settings and collections](phase-2-leaf-settings-and-collections.md)
- [Phase 3: Character and chat ownership](phase-3-character-and-chat-ownership.md)
- [Phase 4: Prompt, lorebook, and script ownership](phase-4-prompt-lorebook-and-script-ownership.md)
- [Phase 5: Broad settings and shell ownership](phase-5-broad-settings-and-shell-ownership.md)
- [Phase 6: Facade and bridge removal](phase-6-facade-and-bridge-removal.md)
- [Phase 7: Temporary seams, verification, and closeout](phase-7-temporary-seams-verification-and-closeout.md)

## Slice Template

Use `phases/slices/phase-<n>-<slug>/<slice>.md`. Record status, owner, opening
and dependency cursors, source consumers and target owner API, read/hydration/
payload boundary, mutations/persistence/revisions/events, optimistic/draft/
queued/failure/rollback/reload/recovery behavior, bridge rollback seam, render/
generation dependencies, allowed files, validation, measurements, residual risk,
and stopping condition.

## Common Entry Gate

- Phase 0 inventory names every consumer in the family.
- Workstream 1 contract and Workstream 2 canonical-owner cursors are released.
- Owner API gaps are closed without creating an aggregate replacement.
- The active slice is linked from `status.md`; Workstream 2 is not changing the
  same persisted owner.

## Common Exit Gate

- The family's aggregate/bridge consumer count is zero.
- Read, lazy hydration, mutation, accepted/queued/failed, rollback, reload,
  writer loss, event invalidation, and authoritative refresh pass.
- Payload and reactive boundaries do not widen unexpectedly.
- The bridge rollback seam and residual risks are recorded before removal.
- Exact proof is recorded in `latest-verification.md`.

See [`slices/README.md`](slices/README.md) for slice rules.
