# Client Resource Ownership Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [leaf setting owner contract](phases/slices/phase-1-resource-owner-foundation/leaf-setting-owner-contract.md).

1. Rank low-fanout standalone settings by exact production consumers and choose
   one with a released read and durable command operation.
2. Prove it is one singular persisted settings row with no competing canonical
   owner or editor-body boundary.
3. Complete its narrow lifecycle, mutation settlement, outbox, optimistic,
   rollback, writer-loss, reload, and recovery contract.
4. Mark drafts explicitly owner-scoped or not applicable and update the checked
   gap matrix evidence.
5. Keep all production consumers and compatibility paths unchanged until the
   Phase 2 migration slice.

## Required Scope Before Editing

The next implementation must name source consumer rows, the exact target owner
API, read state, command outcomes, optimistic/current-attempt rollback, outbox
identity, draft disposition, reload/recovery tests, and dependency commits.

## First Dependency Candidates

- Standalone settings are the first candidate pool because their read contract
  is released at `33d1643ae`; the exact durable command must also be present in
  the `3f275e9dc` catalog.
- `lorebookPageOwner` at `1727cbe35` is evidence for the narrow read lifecycle,
  but it does not release the broader lorebook/editor family.
- Prompt, model/translator, and bridge-removal work remains held by Workstream 2.

## Not First

- Do not replace `getDatabase()` with a common snapshot or common epoch.
- Do not migrate a production consumer before its complete owner contract and
  Workstream 1/2 cursors exist.
- Do not remove trusted writes, write guards, bridges, or lifecycle flushes.
- Do not widen the shell/bootstrap/resource payload.
- Do not add event deltas.

## Handoff

After one leaf has a complete owner contract, close Phase 1 and open Phase 2
only for that exact leaf.
