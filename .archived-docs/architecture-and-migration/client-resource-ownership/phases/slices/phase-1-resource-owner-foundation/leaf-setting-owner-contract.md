# Leaf Setting Owner Contract

Status: complete at `e751edc69`.

Parent: [Phase 1](../../phase-1-resource-owner-foundation.md)

Opening foundation cursor: `1727cbe35`.

## Objective

Select one low-fanout standalone setting whose storage owner and Workstream 1
contracts are already released, then complete its narrow owner API so Phase 2
can migrate that family without reaching through the compatibility facade.

## Selection Gate

- Record the exact Phase 0 consumer rows and production consumers for the
  candidate.
- Prove the persisted value is one singular settings row and has no second
  canonical owner.
- Use the standalone-settings contract at `33d1643ae`, durable command catalog
  at `3f275e9dc`, and browser route reconciliation at `6a6d0ac1f` only where the
  exact operations are present.
- Reject candidates that require a broad settings snapshot, editor body,
  cross-family draft, or unreleased command contract.

Selected leaf: standalone `loreBookPage`.

- Phase 0 rows in scope are `lorebook:generation`, `lorebook:read`,
  `lorebook:render`, `lorebook:recovery`, `lorebook:diagnostic`, and their
  `lorebook:test-fixture` proof. This foundation moves none of them.
- Direct production page consumers are the global lorebook settings/list
  surfaces, lorebook prompt processing, plugins, the resource manifest/state,
  the compatibility bridge, and legacy database normalization. Phase 2 must
  split page selection from lorebook body ownership rather than migrate this
  list as an aggregate.
- Server range proof confirms selection writes only the settings row, while the
  durable operation is `lorebook-select` with semantic owner ordering by stable
  lorebook id.

## Required Owner Contract

- Stable identity and scoped snapshots with
  unloaded/loading/ready/stale/error, authoritative refresh, retry, and revision
  fencing.
- Accepted/queued/failed command outcomes, deterministic outbox identity,
  optimistic projection, and current-attempt-only rollback.
- Explicit proof that drafts are owner-scoped or not applicable for this leaf.
- Contract tests for success, stale response, failed/queued settlement, writer
  loss, rollback, and reload/recovery.
- Update the gap matrix capability row and dependency evidence without copying
  Phase 0 consumer observations.

## Safety Contract

Do not move a production consumer, remove a bridge or trusted-write path, widen
bootstrap/resource payloads, or add an aggregate snapshot/epoch. Rollback is
local to the unused owner API until the later Phase 2 migration slice.

## Validation

Focused owner/read/command/outbox tests, the affected frontend set, mandatory
architecture gates, relevant typechecks, formatting, and `git diff --check`.

## Done When

One leaf setting is marked dependency-released and complete for selectors,
resource state, commands, draft disposition, and contract tests. Phase 2 may
then open only for that exact setting.

## Release

- `lorebookPageOwner` owns the focused read lifecycle and the standalone page
  projection with stable subscription identity.
- `lorebookPageSelectionPersistence` uses the reviewed `lorebook-select`
  operation, deterministic selection/owner keys, encrypted outbox staging,
  active-writer retention, and replay settlement.
- Owner tests prove optimistic success, queued settlement, current-attempt-only
  rollback, supersession, stale revision rejection, and authoritative reload.
- Drafts are explicitly not applicable to the page pointer. Lorebook bodies and
  their editor drafts remain separate.
