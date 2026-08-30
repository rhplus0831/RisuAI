# Prompt-Info Snapshot Ownership

Status: ready.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move store-agnostic prompt preset/toggle snapshot formatting to a neutral owner
used by browser and Fastify generation.

## Boundary And Contract

Use narrow structural toggle and output records rather than importing aggregate
database/message declarations. Preserve disabled output, preset-name coercion,
select index formatting, text/textarea values, boolean ON rows, ordering, and
unknown/missing value behavior. Expected delta: one production runtime edge;
165 total edges become 164.

## Verification

Run shared behavior/ownership, browser send-context prompt-info, Fastify
effective generation/assembly or generation-chat proof, both typechecks,
architecture inventory, formatting, and diff checks.
