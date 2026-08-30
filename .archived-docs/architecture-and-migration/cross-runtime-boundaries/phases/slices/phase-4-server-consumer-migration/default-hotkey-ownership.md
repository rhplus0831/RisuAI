# Default Hotkey Ownership

Status: complete at `2a5a83d37`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move default chords and retired action identifiers to a neutral owner used by
browser initialization and Fastify normalization.

## Boundary And Contract

Preserve action order, keys/modifiers, retired-action insertion order, mutable
array shape, filtering, and missing-action repair. Delivered delta: one
production runtime edge; 197 total edges became 196.

## Verification

Shared behavior/ownership, Fastify defaults, browser database, and navigation
suites passed 2, 1, 27, 135, and 13 tests. Both typechecks, the 196-edge
inventory, formatting, and diff checks passed.
