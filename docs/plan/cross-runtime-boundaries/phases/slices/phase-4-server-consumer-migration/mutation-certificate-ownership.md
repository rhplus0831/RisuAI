# Mutation-Certificate Ownership

Status: ready.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: Phase 3 shared-core conventions.

## Objective

Move deterministic persona and script-definition certificate serialization to
a neutral shared owner used by browser and Fastify command lanes.

## Boundary

- Persona ID, collection, and legacy-profile digest inputs.
- Script-definition collection digest input.
- Expected delta: two production and two server-test runtime/mixed root-`src`
  edges; 203 total edges become 199.

## Behavior Contract

Preserve every version prefix, JSON array order, recursive lexical object-key
sorting, own `__proto__` keys, and persona profile field order. Mutation
classification, hashing, command validation, persistence, revisions, receipts,
events, and rollback remain in their existing owners.

## Validation

Run shared behavior/ownership, persona certificate/persona command, script
mutation, browser command, and Fastify command suites; run both typechecks,
architecture inventory, formatting, and diff checks.
