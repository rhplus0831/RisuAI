# Durable Command Operation Catalog

Status: implemented at `3f275e9dc`; focused and affected verification passed.

Parent: [Phase 2](../../phase-2-route-operation-and-policy-catalog.md)

Depends on: shared route operation catalog at
`00e49d880797e248b967051c5c81a7d8208d231d`.

## Objective

Replace the browser outbox's private regular-expression allowlist with stable,
browser-safe durable-operation identifiers while preserving its exact request
acceptance, rejection, queueing, and replay behavior.

## Contract

- Publish one identifier and method/path matcher for each currently allowed
  durable command pattern from an explicit protocol subpath.
- Keep request matching deterministic and browser-safe; descriptors carry no
  authority, storage, retry scheduling, or replay behavior.
- Relate durable generation submit, cancel, and retry intents to shared route
  operation identifiers without replacing runtime generation UUIDs.
- Reject duplicate identifiers or ambiguous matches and retain adversarial
  near-miss fixtures for paths that must never enter the outbox.

## Validation

Protocol catalog/import-boundary fixtures, durable-outbox parity and near-miss
fixtures, architecture inventory comparison, protocol/browser typechecks,
affected frontend/server and current compatibility lanes, formatting, and
`git diff --check`.

## Done When

- No browser-local anonymous durable-command allowlist remains.
- Every accepted queued command resolves to one stable operation identifier.
- Generation intents point at stable shared route operations.
- Queueing, replay, retry, and rejection behavior are unchanged.

Stop if the catalog would need to own browser persistence or server authority.

## Release

- `@risuai/protocol/durable-command-operation` owns 129 stable command
  identifiers and exact method/path matchers.
- The opening matcher sequence is frozen by SHA-256 and every reviewed example
  resolves uniquely; duplicate identifiers, duplicate matchers, and ambiguous
  examples fail closed.
- Durable generation submit, cancel, and retry kinds reference the existing
  shared route operation identifiers while retaining the stricter legacy path
  exclusions and runtime generation UUIDs.
- Browser outbox storage, encryption, ordering, replay, retry, rejection,
  authentication, active-writer, and server policy behavior did not move.

Validation is recorded in [`../../../latest-verification.md`](../../../latest-verification.md).
