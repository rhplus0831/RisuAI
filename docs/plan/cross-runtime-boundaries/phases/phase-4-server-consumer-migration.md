# Phase 4: Server Consumer Migration

Status: active.

Depends on: destination protocol/shared contracts passing their boundary and
parity gates.

## Objective

Replace Fastify production and server-test imports from `src/` in domain-sized,
independently revertible slices.

## Required Work

- Migrate wire contracts to `@risuai/protocol` and neutral behavior to the
  audited shared owner.
- Replace broad `Database` inputs with domain-shaped records or explicit
  parameters.
- Move server-only behavior into `server/fastify` rather than widening shared
  packages.
- Migrate test fixtures to neutral fixtures or clearly classified test-only
  owners.
- Keep the Phase 0 inventory and no-new-debt baseline current after every slice.

## Safety Contract

Each slice names its route/mutation, persistence writes, event/revision behavior,
masking, rollback, and parity proof. Extraction cannot silently repair data or
change provider/prompt behavior.

## Exit Criteria

- Production Fastify contains no unapproved browser-tree import.
- Server-test imports are eliminated or retained only as explicit, owned
  test-fixture exceptions with removal/review triggers.
- Complete owning server lanes pass after each broad domain closes.

## Validation

Import gate, focused domain tests, complete server lane for broad slices,
protocol/shared checks, `pnpm check:server`, compatibility fixtures when shared
behavior moves, formatting, and diff checks.

Completed slice: [BardWiki server type seam](slices/phase-4-server-consumer-migration/bardwiki-server-type-seam.md).

Active slice: [Memory-embedding configuration seam](slices/phase-4-server-consumer-migration/memory-embedding-configuration-seam.md).
