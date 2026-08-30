# Settings-Group Catalog Ownership

Status: complete at `a0f8931c5`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

## Objective

Move the dependency-free settings group and projection vocabulary to a neutral
owner used by the browser facade and Fastify import/parity consumers.

## Boundary And Contract

Preserve group names, key ownership, read-only agent/model projections, the
translator preset read projection, and generic writable policy. Route
authorization, writers, persistence, and revision fences remain Fastify-owned.
Delivered delta: one production and three server-test runtime edges; 185 total
edges became 181.

## Verification

Shared import/ownership checks passed 2, 1, and 1 tests. Fastify settings
parity, Phase 3/5 compatibility structure, and browser resource-manifest tests
passed 6, 7, 6, and 45 tests. Both typechecks, the 181-edge inventory,
formatting, and diff checks passed.
