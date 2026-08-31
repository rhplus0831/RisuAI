# Owner API Gap Matrix And First Foundations

Status: complete at `1727cbe35`.

Parent: [Phase 1](../../phase-1-resource-owner-foundation.md)

Opening inventory cursor: `0432b32ba1bcb7f8a3d5ca68a5605dd47a26857f`.

## Objective

Turn every frozen compatibility consumer group into a concrete, narrow owner API
requirement, then implement the first dependency-released foundations without
creating a replacement aggregate facade.

## Required Matrix

For each resource family and consumer role, record whether the target owner has:

- stable-identity selectors and scoped reactive state;
- unloaded/loading/ready/stale/error state, retry, and authoritative refresh;
- accepted/queued/failed command outcomes, outbox keys, optimistic projection,
  and current-attempt rollback;
- owner-scoped drafts, lineage and active-writer fencing, reload, and recovery;
- owner-contract tests for success, stale response, failure, writer loss, and
  restart/reload behavior.

Every gap names its exact Workstream 1 contract and Workstream 2 canonical-owner
cursor. Already-complete capabilities link to tests rather than being rebuilt.

## Allowed Changes

- A checked-in owner API gap matrix derived from the Phase 0 baseline.
- Narrow selectors, hydration state, command/draft helpers, or contract tests for
  one dependency-released owner at a time.
- Status, dependency-cursor, and verification updates.

Do not migrate a production compatibility consumer or remove its bridge in the
same foundation slice.

## Behavior Contract

- Existing facade reads, trusted writes, bridges, flushes, payloads, persistence,
  revisions, events, and invalidation remain available.
- New owner foundations preserve lazy body boundaries and authoritative refresh.
- Common primitives must be resource-keyed and cannot expose an all-resource
  snapshot or any-resource epoch.
- Rollback for each implementation commit is local to the new owner API because
  no production consumer has moved yet.

## Validation

Focused owner/resource/command/outbox tests, affected frontend tests, the
mandatory architecture gates, relevant typechecks, browser smoke for
startup-sensitive foundations, formatting, and `git diff --check`.

## Done When

- Every inventory policy has a verified existing capability or a bounded owner
  API/test gap with dependency cursors.
- At least one dependency-released owner foundation passes its complete contract
  tests without increasing any Phase 0 compatibility count.
- `status.md` records the exact foundation release for the first eligible family.

Stop if a proposed API spans unrelated resource families, a persisted owner is
ambiguous, the wire/operation contract is unreleased, or a foundation would
require changing a production consumer.

## Release

- `owner-api-gap-matrix.json` maps all 56 frozen policy rows to nine narrow
  owner families, classifies all five required capabilities, records the exact
  dependency state, and is enforced by the mandatory architecture inventory.
- `lorebookPageOwner` is the first dependency-released foundation. It owns only
  the standalone `loreBookPage` pointer and its focused
  unloaded/loading/ready/stale/error, retry, revision-fence, failure, and
  supersession lifecycle.
- No production consumer moved. The Phase 0 inventory remains exactly 9,917
  references across 325 consumer groups, six bridge families, and 20 temporary
  seam rows.
