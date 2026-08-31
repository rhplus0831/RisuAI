# Compatibility Surface Inventory And Disposition Matrix

Status: complete at `cd04b0e11f2c8629e988af1ef6c99a2646a746f1`.

Parent: [Phase 0](../../phase-0-compatibility-inventory-and-retention-policy.md)

Opening Fastify cursor: `c0df82d5240a29a33efa5995e08cc970e0147573`.

Depends on: Workstream 1 Phase 0 package/dependency convention release.

## Objective

Create a closed-world compatibility inventory and give every in-scope surface
one retention disposition before any runtime migration begins.

## Required Inventory Fields

- stable id, resource family, symbol/field/table/route/command, and current owner;
- read/write/fallback/repair/import/export/backup/recovery consumers;
- current precedence and missing/null/malformed/damaged behavior;
- historical fixture and provenance;
- disposition: canonical, migrate, import-only, export-only, explicit
  compatibility, quarantine, or remove;
- target owner, migration phase, old reader/exporter, rollback proof, and
  Workstream 3 release/hold cursor.

## Starting Anchors

- `server/fastify/src/db.ts`, `repository.ts`, `databaseDefaults.ts`
- `server/fastify/src/commands/modelProfiles.ts`, `splitPresets.ts`,
  `prompts.ts`, `translatorPresets.ts`
- `server/fastify/src/routes/commands.ts`, `routes/resourceReads.ts`
- `server/fastify/src/risuSave/importSnapshot.ts` and export/backup owners
- `src/ts/model/`, `src/ts/translator/`, `src/ts/storage/database.svelte.ts`
- `test/compat-harness/` and relevant archived ownership/compatibility records

## Behavior Contract

- Mutations: none.
- Persistence, revision, receipt, and event effects: none.
- Rollback: remove or revise the inventory; no runtime rollback is required.

## Validation

Inventory schema/closed-world tests, fixture-existence/provenance checks,
focused structural tests, affected tests, formatting, and `git diff --check`.

## Done When

- Every in-scope surface has exactly one disposition and no owner is ambiguous.
- Precedence, downgrade/export, failure, interruption, and damaged-database
  policy are explicit.
- Historical fixtures are named and locally reproducible or their gap blocks the
  relevant later phase.
- Each resource family has a Workstream 3 hold/release rule.

Stop if a disposition requires an unsigned compatibility/product decision, if a
historical input cannot be reproduced, or if the Workstream 1 convention would
be bypassed.

## Result

The reviewed [`compatibility-baseline.json`](../../../compatibility-baseline.json)
contains 19 unambiguous surfaces and 38 fail-closed identifier/table/route
probes. Existing tests provide local provenance for every row. Runtime ownership,
persistence, revisions, receipts, events, imports, exports, and recovery behavior
did not change in this inventory slice.
