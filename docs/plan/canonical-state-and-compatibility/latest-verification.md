# Canonical State And Compatibility Retirement Latest Verification

Date: 2026-08-30

## Candidate

- Implementation commit: `cd04b0e11f2c8629e988af1ef6c99a2646a746f1`
- Opening anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`
- Workstream 1 convention release: `b01e88b03461753afe8f573029ce2e5ab47892ef`
- Environment: Node `v24.19.0`, pnpm `11.23.0`, Linux workspace
- Scope: Phase 0 inventory/disposition gate only; no persistence, revision,
  receipt, event, import/export, recovery, or runtime ownership changed.

## Inventory

- 19 surfaces: 4 model configuration, 5 prompt template, 4 translator, 3
  repair, and 3 interchange.
- Dispositions: 4 canonical, 9 migrate, 3 import-only, 2 explicit
  compatibility, and 1 remove.
- 38 closed-world identifier, table, and route probes.
- Every row records current and target owner, roles, precedence,
  missing/malformed/damaged behavior, local fixture and provenance, old reader
  or exporter, rollback proof, migration phase, and Workstream 3 cursor.

## Commands And Results

- `pnpm exec vitest run util/architecture-inventory.test.ts util/check-server.test.ts`
  — passed, 2 files and 11 tests.
- `pnpm exec tsx util/architecture-inventory.ts` — passed the 375-edge boundary
  baseline and 19-surface/38-probe compatibility matrix.
- `pnpm check:server` — passed protocol, both architecture inventories, client
  declarations, Fastify, and browser-smoke typechecks.
- `pnpm test:affected --dry-run` — selected affected frontend tests.
- `pnpm test:affected` — passed, 1 file and 6 tests.
- `pnpm format:check` — passed.
- `git diff --check` — passed.

## Verdict

Phase 0 passes. Every in-scope owner is unambiguous and every historical fixture
is locally reproducible. Workstream 3 holds remain in force per resource row;
no runtime owner is released yet. Phase 1 migration/recovery foundation is the
next cursor.
