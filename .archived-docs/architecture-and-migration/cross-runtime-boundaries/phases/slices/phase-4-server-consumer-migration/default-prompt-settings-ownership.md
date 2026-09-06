# Default Prompt-Settings Ownership

Status: complete at `8a07be89e`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move the auto-suggest prompt and fresh input-hook factory to a neutral owner
used by browser settings and Fastify initialization.

## Boundary And Contract

Preserve prompt text, hook ID/name/type/model selection, and fresh array/row/
model allocation. Prebuilt and legacy prompt templates remain browser-owned.
Delivered delta: one production runtime edge; 196 total edges became 195.

## Verification

Shared behavior/ownership, Fastify defaults, and browser suggestion suites
passed 2, 1, 27, and 22 tests. Both typechecks, the 195-edge inventory,
formatting, and diff checks passed.
