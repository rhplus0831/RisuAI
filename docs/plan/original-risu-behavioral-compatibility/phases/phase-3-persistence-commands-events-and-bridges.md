# Phase 3 — Persistence, Commands, Events, And Bridges

Status: Pending  
Depends on: Phases 1-2

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
