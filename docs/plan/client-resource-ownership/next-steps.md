# Client Resource Ownership Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [owner API gap matrix and first foundations](phases/slices/phase-1-resource-owner-foundation/owner-api-gap-matrix-and-first-foundations.md).

1. Project the frozen 325 consumer groups onto their target owner APIs and name
   missing selector, hydration, command, optimistic, draft, rollback, error,
   outbox, writer-loss, and recovery capabilities.
2. Distinguish implementation gaps from owner-contract test gaps and from
   consumers that can already migrate after their Workstream 1/2 cursors release.
3. Reject any common API that returns multiple unrelated resource families or
   publishes an any-resource epoch.
4. Implement and test the first narrow foundation only after its matching
   protocol and canonical-owner cursor is recorded.
5. Keep every compatibility bridge and fallback path until the later family
   migration proves accepted/queued/failed, rollback, reload, and recovery.

## Required Scope Before Editing

Each foundation slice must name source consumer groups, the exact target owner
API, payload/lazy-body boundary, read and hydration state, command outcomes,
optimistic projection and current-attempt rollback, drafts and writer fencing,
outbox behavior, authoritative refresh, tests, and dependency commits.

## First Dependency Candidates

- Shell and character-summary owner gaps may be refined while Workstream 1
  extracts their wire contracts.
- Leaf settings/collection owners may proceed only where the persisted owner is
  already singular and the matching operation contract is released.
- Prompt, model/translator, and bridge-removal work remains held by Workstream 2.

## Not First

- Do not replace `getDatabase()` with a common snapshot or common epoch.
- Do not migrate a production consumer before its complete owner contract and
  Workstream 1/2 cursors exist.
- Do not remove trusted writes, write guards, bridges, or lifecycle flushes.
- Do not widen the shell/bootstrap/resource payload.
- Do not add event deltas.

## Handoff

After a narrow owner foundation passes its contract tests, record its exact
release cursor in `status.md` and open only the matching resource-family
consumer migration.
