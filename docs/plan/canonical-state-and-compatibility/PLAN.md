# Canonical State And Compatibility Retirement Plan

Date: 2026-08-30

Status: active. Phase 0 closed at `cd04b0e11`; Phase 1 migration and recovery
foundation is the execution cursor.

## Goal

Give each persisted domain one canonical internal owner. Preserve supported old
formats through explicit migration, import, export, or compatibility actions
instead of normal-runtime mirrors, fallback precedence, or opportunistic repair.

This workstream activates Workstream 2 of the
[Architecture Modernization Roadmap](../../architecture-modernization/PLAN.md).
[`status.md`](status.md) owns the moving execution and dependency cursors. This
plan does not change current compatibility behavior until a resource-family
slice is implemented and verified.

## Opening Baseline

- Durable model profiles and role bindings exist, along with explicit legacy
  conversion paths, but normal resolution and interchange still retain flat
  compatibility inputs.
- Modern prompt presets own template bodies for normal workflows, while the
  aggregate `promptTemplate` compatibility projection and the
  `prompt_templates` SQLite representation still participate in hydration and
  command behavior.
- Translator presets own pipelines, while selection commands still synchronize
  first-step `translatorPrompt` and `translatorMaxResponse` scalars and accept a
  legacy selected index.
- The SQLite schema has a versioned migration runner, but boot, import,
  repository, and ordinary command helpers also perform several `ensure*` and
  `repair*` normalizations.

Phase 0 must classify each surface. Names such as `legacy`, `ensure`, or
`repair` are leads, not removal evidence.

## End State

- Model configuration normally resolves through durable profiles and bindings.
- Prompt templates have one normal durable owner.
- Translator presets do not require normal-runtime legacy scalar mirrors.
- Ordinary commands validate persisted state and mutate only their declared
  range instead of repairing unrelated records.
- Old saves normalize into canonical current state at a durable boundary.
- Explicit legacy exports reconstruct supported old fields without making those
  fields live internal owners.
- Backup/restore, database lineage, receipts, revisions, replay, and
  authoritative recovery remain intact.

## Invariants

1. No readable historical input is dropped without an explicit retention
   decision and fixture.
2. Each in-scope surface has exactly one disposition: canonical, migrate,
   import-only, export-only, explicit compatibility, quarantine, or remove.
3. Precedence, missing/null/malformed behavior, downgrade/export behavior, and
   damaged-database behavior are decided before a mirror or fallback is removed.
4. Migration is versioned, idempotent, transactional, restart-safe, and aware of
   database lineage, backup, and rollback.
5. Compatibility normalization occurs at import, schema migration, export, or
   an explicit recovery/compatibility action, never as a hidden second runtime
   owner.
6. Persisted-owner changes and Workstream 3 bridge removal for the same resource
   family never run concurrently.
7. Workstreams 2 and 3 may overlap only on different resource families with
   independent rollback paths.
8. User-visible generation, prompt, and translation behavior remains unchanged
   unless a separate compatibility decision explicitly says otherwise.

## In Scope

- Model profiles, role bindings, presets, flat model/provider fields, resolver
  fallbacks, and authoring paths.
- Prompt preset templates, aggregate prompt projections, SQLite template
  storage, legacy bot presets, and prompt import/export.
- Translator preset pipelines, selected preset ownership, legacy first-step
  scalars, and chat-scoped selections.
- Smaller mirrors classified by Phase 0.
- Schema migrations, boot/import recovery, command validation/repair boundaries,
  backups, restores, current/legacy import and export, and obsolete storage.

## Non-Goals

- Dropping readable old saves without an explicit compatibility decision.
- Combining persisted migration with client facade or bridge removal.
- Changing model/provider dispatch, prompt output, or translation results beyond
  resolving ownership ambiguity.
- Treating every `legacy`, `ensure`, or `repair` symbol as in-scope or removable.
- Adding event deltas or changing single-writer behavior.

## Dependency Cursors

| Cursor | Initial value | Meaning |
| --- | --- | --- |
| Opening Fastify code anchor | `c0df82d5240a29a33efa5995e08cc970e0147573` | Code state inspected for plan activation. |
| Workstream 1 boundary convention | Released at `b01e88b03` | Phase 0 inventory is unblocked; shared-contract choices still wait for the matching Phase 1 contract. |
| Compatibility baseline | `71c476e9c86263fe907105b011ca4dde0a619d66` | Immutable pre-Fastify behavioral source for historical fixtures, where applicable. |
| Behavioral sync cursor | `f3f0242fba297d82e0efcc2c31ca1428569b70f2` | Latest upstream unit already dispositioned; not a source-equivalent ancestor. |
| Workstream 3 model-owner release | Not released | Phase 2 closes before browser model compatibility access is retired. |
| Workstream 3 prompt-owner release | Not released | Phase 3 closes before prompt bridge removal. |
| Workstream 3 translator/smaller-owner release | Not released | Phase 4 closes per family before bridge/facade retirement. |

Exact per-resource implementation cursors live in [`status.md`](status.md).

## Work Units

One slice covers one resource family and one migration/proof boundary. It names:

- current canonical candidates, mirrors, fallbacks, tables, routes, commands,
  adapters, imports, exports, and fixtures;
- the selected disposition and precedence/failure/downgrade decisions;
- exact records/tables mutated, transaction and persistence effects, revision
  and event behavior, backup/rollback path, and restart behavior;
- old reader/exporter retained during rollout and the proof required before its
  removal;
- focused, historical-fixture, compatibility, restart, and browser evidence;
- the Workstream 3 dependency cursor released on completion.

Do not remove a compatibility field in the slice that first establishes its
replacement migration.

## Phase Order

| Phase | Outcome |
| ---: | --- |
| [0. Compatibility inventory and retention policy](phases/phase-0-compatibility-inventory-and-retention-policy.md) | Every surface has one disposition and explicit precedence/failure policy. |
| [1. Migration and recovery foundation](phases/phase-1-migration-and-recovery-foundation.md) | Migrations are idempotent, restart-safe, transactional, and fixture-backed. |
| [2. Model configuration ownership](phases/phase-2-model-configuration-ownership.md) | Normal model resolution has one durable profile/binding owner. |
| [3. Prompt-template ownership](phases/phase-3-prompt-template-ownership.md) | Modern prompt presets are the only normal template owner. |
| [4. Translator and smaller compatibility mirrors](phases/phase-4-translator-and-smaller-mirrors.md) | Each selected domain has one internal read/write contract. |
| [5. Repair boundary](phases/phase-5-repair-boundary.md) | Ordinary commands validate without unrelated repair or id minting. |
| [6. Import, export, backup, and obsolete storage](phases/phase-6-interchange-backup-and-obsolete-storage.md) | Supported interchange round-trips canonical state without a second owner. |
| [7. Verification and closeout](phases/phase-7-verification-and-closeout.md) | Migration, compatibility, docs, and residual surfaces are fully recorded. |

## Rollback

Each domain phase retains a pre-migration backup and an old reader or compatible
export path until post-migration read, restart, command, and export proofs pass.
Migrations must be safe to retry after interruption. A rollback never rewinds
database lineage, active-writer epoch, mutation receipts, or event history
independently of the authoritative restore protocol.

## Closeout Criteria

- Every in-scope field, table, adapter, route, fallback, and compatibility file
  has a final disposition and exact boundary.
- Model, prompt, translator, and selected smaller domains have one normal
  internal read/write contract.
- Ordinary commands do not repair or mutate unrelated persisted records.
- Current backup/export and supported historical formats normalize and
  round-trip through canonical state with deterministic failure behavior.
- Migration interruption, rollback, restart, damaged-database, lineage, and
  restore tests pass.
- Provider, prompt, translation, command, browser, compatibility, typecheck,
  formatting, and documentation gates pass at one recorded commit.
- Per-resource release cursors are handed to Workstream 3 and the intact plan is
  ready to archive.
