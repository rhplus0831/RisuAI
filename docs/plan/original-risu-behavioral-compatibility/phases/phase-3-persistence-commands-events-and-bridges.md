# Phase 3 — Persistence, Commands, Events, And Bridges

Status: Complete
Depends on: Phases 1-2
Completed at Fastify: `f25376ef369cc4c74a38c992f2e2aaa9b7fd7d74`

## Objective

Verify that commands, events, editing bridges, and SQLite preserve the original
logical state, mutation semantics, identity, ordering, metadata, and feedback
even though the physical persistence architecture differs.

## Audit Questions

- Is every retained mutable field represented by a command/persistence owner,
  including legacy nested and optional substructures?
- Do create/edit/delete/reorder/copy/fork operations preserve IDs, references,
  revisions, message metadata, and selection semantics?
- Are success, conflict, validation failure, stale revision, and server failure
  projected consistently to browser state and visible feedback?
- Do command receipts and events distinguish accepted, durable, rejected, and
  replayed outcomes without double application?
- Do direct editing bridges bypass normalization, validation, event emission, or
  backup/export ownership?

## Required Outputs

- Closed-world command/resource/event/persisted-field classification.
- Baseline/current fixtures for mutation inputs and post-reload logical state.
- Integration cases through production Fastify routes and real SQLite.
- Fault/race cases for stale writes, replay, deletion, ordering, and restart.
- Canonical findings for omitted fields, coercion, silent no-ops, or wrong
  durability/feedback semantics.

## Exit Criteria

- Every retained durable field and mutation has an owner and evidence.
- Logical results match baseline or a signed decision despite physical schema
  differences.
- Receipt/event/reload behavior cannot hide lost or duplicate mutations.
- Focused command, persistence, bridge, state-sync, and compatibility lanes pass.

## Validation

Run focused unit/integration tests with real SQLite, command/event structural
checks, browser reload evidence for visible mutations, affected and compatibility
lanes, formatting, and `git diff --check`.

## Completion Evidence

- A closed-world structural gate at
  `958f8585138ec817fe5d134563df585434ed5821` pins all 161 command routes and
  mutation policies, all 422 retained logical Database fields, all 46 SQLite
  tables and their exact columns, all 146 command events and resource
  reconciliation branches, replay ordering, and all six built-in editing
  bridges.
- Browser and server writable-setting catalogs are identical. The audit restored
  six retained legacy-memory settings to the command owner and added the two
  retained auto-continue interchange fields to the current Database type.
- Five legacy Agent Preset step events are explicitly replay-only; missing,
  duplicate, reordered, or ahead revisions fail closed rather than partially
  applying.
- BardWiki rebuild previews and vault dry runs accept only exact eventless
  non-mutating receipts at
  `3f20a80b780f2538fd1e38aa6514d9a9f894985a`; mutating imports and queued
  rebuilds remain event-required.
- Category C rows `ORC-SURFACE-089` through `ORC-SURFACE-093` own the new
  structural surfaces. Historical Category C rows `ORC-SURFACE-024`,
  `ORC-SURFACE-025`, `ORC-SURFACE-061`, and `ORC-SURFACE-073` are re-verified
  with their signed decisions and resolved finding intact.
- The completion commit passed the focused production command/resource lane,
  structural ownership lane, browser command/event lane, recovery owners, and
  pinned differential. Exact commands and counts are in
  [`latest-verification.md`](../latest-verification.md).
