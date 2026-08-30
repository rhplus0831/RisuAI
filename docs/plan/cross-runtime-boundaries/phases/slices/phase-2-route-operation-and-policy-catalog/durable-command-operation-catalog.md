# Durable Command Operation Catalog

Status: ready.

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
formatting, and `git diff --check`. The full affected suite remains deferred for
this session at user request.

## Done When

- No browser-local anonymous durable-command allowlist remains.
- Every accepted queued command resolves to one stable operation identifier.
- Generation intents point at stable shared route operations.
- Queueing, replay, retry, and rejection behavior are unchanged.

Stop if the catalog would need to own browser persistence or server authority.
