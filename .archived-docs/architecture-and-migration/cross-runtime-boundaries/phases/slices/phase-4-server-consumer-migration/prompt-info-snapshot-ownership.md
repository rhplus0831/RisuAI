# Prompt-Info Snapshot Ownership

Status: complete at `8d7bc6256`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move store-agnostic prompt preset/toggle snapshot formatting to a neutral owner
used by browser and Fastify generation.

## Boundary And Contract

Use narrow structural toggle and output records rather than importing aggregate
database/message declarations. Preserve disabled output, preset-name coercion,
select index formatting, text/textarea values, boolean ON rows, ordering, and
unknown/missing value behavior. Delivered delta: one production runtime edge;
165 total edges became 164.

## Verification

Shared behavior, import-boundary, and ownership suites passed 3, 2, and 1 tests;
browser send-context and Fastify assembly passed 23 and 135 tests. Both
typechecks, the 164-edge architecture inventory, formatting, and diff checks
passed.
