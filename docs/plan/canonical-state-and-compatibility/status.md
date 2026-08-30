# Canonical State And Compatibility Retirement Status

Date: 2026-08-30

This is the mutable execution router. Stable scope lives in [`PLAN.md`](PLAN.md),
phase detail in [`phases/`](phases/README.md), selection guidance in
[`next-steps.md`](next-steps.md), and exact proof in
[`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active; Phases 0 and 1 complete.
- Current phase: [Phase 2 model configuration ownership](phases/phase-2-model-configuration-ownership.md).
- Active slice: [Legacy flat model configuration migration](phases/slices/phase-2-model-configuration-ownership/legacy-flat-model-configuration-migration.md), ready.
- Opening Fastify code anchor: `c0df82d5240a29a33efa5995e08cc970e0147573`.
- Runtime changes through Phase 1: migration startup now validates the named
  catalog and fails closed on damaged existing schema identity/current tables;
  normal persisted domain owners are unchanged.
- Latest verification: Phase 1 passed at `1e758cd22`.

## Dependency Cursors

| Dependency or release | Cursor | State |
| --- | --- | --- |
| Workstream 1 package/boundary conventions | `b01e88b03` | Released; Phase 0 may execute. |
| Workstream 1 shared contracts | Per contract family | Required only before a slice introduces or consumes that shared contract. |
| Migration/recovery foundation | `1e758cd22` | Released with named-step validation, rollback/retry/reopen injection proof, damaged-database refusal, and all 19 historical fixture adapters. |
| Model configuration canonical owner | Phase 2 | Not released to Workstream 3. |
| Prompt-template canonical owner | Phase 3 | Not released to Workstream 3. |
| Translator/smaller canonical owners | Phase 4 per family | Not released to Workstream 3. |
| Repair/interchange cleanup | Phases 5-6 | Not started; may add per-family holds to earlier releases. |

## Opening Research Snapshot

- `server/fastify/src/db.ts` has a versioned migration runner; repository boot,
  import, and command modules also contain normalizers and repair helpers.
- Durable model profile records and role bindings coexist with legacy conversion
  and fallback paths.
- Prompt ownership spans modern prompt-preset bodies, the aggregate
  `promptTemplate` compatibility field, hydration/substitution behavior, and the
  `prompt_templates` table.
- Translator preset commands synchronize selected preset data into legacy
  first-step scalar fields.
- Existing compatibility harness fixtures, import/export tests, database tests,
  provider/prompt/translator tests, and archived ownership workstreams provide
  evidence sources; Phase 0 must identify real historical fixture provenance.

## Phase Router

| Phase | Status | Opens when |
| ---: | --- | --- |
| [0. Inventory and retention policy](phases/phase-0-compatibility-inventory-and-retention-policy.md) | Complete | Closed at `cd04b0e11`. |
| [1. Migration/recovery foundation](phases/phase-1-migration-and-recovery-foundation.md) | Complete | Closed at `1e758cd22`. |
| [2. Model configuration](phases/phase-2-model-configuration-ownership.md) | Active | Current execution cursor; foundation passes model historical fixtures. |
| [3. Prompt templates](phases/phase-3-prompt-template-ownership.md) | Queued | Foundation passes prompt historical fixtures. |
| [4. Translator/smaller mirrors](phases/phase-4-translator-and-smaller-mirrors.md) | Queued | Foundation and per-family dispositions are complete. |
| [5. Repair boundary](phases/phase-5-repair-boundary.md) | Queued | Canonical owners exist for affected commands. |
| [6. Interchange/backups/storage](phases/phase-6-interchange-backup-and-obsolete-storage.md) | Queued | Replacement readers/writers and rollback proofs pass. |
| [7. Verification/closeout](phases/phase-7-verification-and-closeout.md) | Queued | Phases 0-6 satisfy exit gates. |

## Blockers And Risks

- No blocker prevents the flat model configuration migration slice.
- A field may be an explicit export projection, not a removable mirror; Phase 0
  must decide before implementation.
- Command-time repair may currently make damaged historical data usable. Moving
  it requires migration/recovery fixtures, not simple deletion.
- Prompt and model ownership affect generation output; parity evidence must be
  model-visible, not merely structural.
- Persisted-owner changes must not overlap the same Workstream 3 resource-family
  bridge removal.

## Start Here

Use [`next-steps.md`](next-steps.md). Migrate usable flat model configuration
into durable profiles/bindings without copying inline secrets or removing the
explicit legacy boundary.
