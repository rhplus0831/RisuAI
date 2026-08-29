# Original RisuAI Behavioral Compatibility Audit Status

Date: 2026-08-30

This is the live execution router. Keep stable scope, taxonomy, evidence rules,
and stopping gates in [`PLAN.md`](PLAN.md); semantic and decision rules in
[`CONTRACT.md`](CONTRACT.md); phase details under [`phases/`](phases/); canonical
findings under [`findings/`](findings/); inventory ownership under
[`inventory/`](inventory/); and command proof in
[`latest-verification.md`](latest-verification.md).

## Current Snapshot

- Plan state: Active.
- Current phase: Phase 1 — harness and assurance architecture.
- Active slice: [Phase 1 reproducible differential and gates](phases/slices/phase-1-harness-and-assurance-architecture/phase-1-reproducible-differential-and-gates.md).
- Planning audit anchor: `1933c43ff7b4d35b57b0852013d95f3881a8cb28`.
- Compatibility baseline: `71c476e9c86263fe907105b011ca4dde0a619d66`.
- Behavioral sync cursor: `f3f0242fba297d82e0efcc2c31ca1428569b70f2`.
- Toolchain observed at opening: Node `v24.19.0`; pnpm `11.23.0`.
- Opening worktree state: clean.
- Full differential prerequisite: available as a clean detached worktree at
  `/home/codex/risu-baseline-71c476e9c`; its exact commit, dependency state, and
  cleanliness are enforced by `pnpm prepare:compat-baseline` and the harness
  preflight.
- Current compatibility state: full pinned differential passed at
  `9ea7aa20dd5a93ac7e5c9112e8c8fbcb9fca1438` (16 baseline cells, 18 current and
  cluster tests, 15 explained baseline/current divergences, healthy cluster 10).
- Canonical findings: 14 historical resolved findings imported with exact raw
  mappings and implementation/verification evidence.
- Open maintainer decisions: four historical unsupported statements remain
  `proposed` because their sources do not identify individual authority.
- Next action: execute the Phase 1 reproducible-differential-and-gates slice,
  then begin the Phase 2 bootstrap/writer/outbox recovery slice.

## Phase Router

| Phase | Status | Outcome |
| ---: | --- | --- |
| [0. Cursors, contract, inventory, and pilot](phases/phase-0-cursors-contract-and-inventory.md) | Complete | Frozen references, exact authority import, fail-closed registers, reproducible baseline, and four verified pilots. |
| [1. Harness and assurance architecture](phases/phase-1-harness-and-assurance-architecture.md) | In progress | Make baselines, fixtures, differential/expected-difference ownership, affected selection, CI, and release gates reproducible. |
| [2. Browser state synchronization and recovery](phases/phase-2-browser-state-sync-and-recovery.md) | Pending | Verify bootstrap, writer, outbox, hydration, invalidation, reload, and recovery behavior. |
| [3. Persistence, commands, events, and bridges](phases/phase-3-persistence-commands-events-and-bridges.md) | Pending | Verify logical durable state, mutation semantics, ordering, identity, receipts, and editing bridges. |
| [4. Navigation, chat, shared UI, and presentation](phases/phase-4-navigation-chat-and-shared-ui.md) | Pending | Verify visible navigation, chat, composer, transcript, hotkey, focus, feedback, and responsive behavior. |
| [5. Settings, profiles, authoring, and catalogs](phases/phase-5-settings-profiles-authoring-and-catalogs.md) | Pending | Verify defaults, legacy shapes, presets, personas, characters, lorebooks, catalogs, and authoring workflows. |
| [6. Prompting, generation, and streaming](phases/phase-6-prompting-generation-and-streaming.md) | Pending | Verify model-visible assembly, transcript mutation, stream/cancel/retry/reattach, and finalization. |
| [7. Providers, models, translation, and media](phases/phase-7-providers-models-translation-and-media.md) | Pending | Verify capability/resolution, credentials, endpoints, provider wire contracts, translation, and media behavior. |
| [8. Memory, embeddings, jobs, and workers](phases/phase-8-memory-embeddings-jobs-and-workers.md) | Pending | Verify retained memory selection, context truncation, jobs, retries, cancellation, and reconciliation. |
| [9. Scripting, parsing, triggers, and automation](phases/phase-9-scripting-parsing-triggers-and-automation.md) | Pending | Verify CBS, regex, Lua, trigger/script ordering and state, transformations, and explicit unsupported effects. |
| [10. Plugins, modules, MCP, and specialized tools](phases/phase-10-plugins-modules-mcp-and-specialized-tools.md) | Pending | Verify retained extension data/APIs/lifecycle, permissions, tools, and no-port boundaries. |
| [11. Assets, imports, exports, saves, and backups](phases/phase-11-assets-import-export-and-backups.md) | Pending | Verify references, codecs, salvage, staged assets, historical formats, and bidirectional round trips. |
| [12. Runtime, platform, limits, and diagnostics](phases/phase-12-runtime-platform-and-diagnostics.md) | Pending | Verify shared platform behavior, visible rejection/diagnostics, browser/server environment, startup/shutdown, and Push. |
| [13. Consolidation, adjudication, and remediation](phases/phase-13-consolidation-adjudication-and-remediation.md) | Pending | Deduplicate findings, settle decisions, land shared gates and fix waves, and close cross-domain ownership. |
| [14. Verification and closeout](phases/phase-14-verification-and-closeout.md) | Pending | Prove zero unexplained differences, complete decisions, final quality/release gates, current docs, and archive handoff. |

## Phase 0 Completion Record

- `STRUCTURE.md` records the behavioral sync cursor separately from the Git fork
  point.
- The archived upstream ledger covers `71c476e9c..f3f0242fb` and records that all
  units were dispositioned before the base advanced.
- The baseline object exists in both repositories; a detached clean worktree was
  prepared without moving `/home/codex/Risuai`, and preflight rejects a wrong
  commit, attached branch, dirty tree, or missing dependencies.
- The upstream register contains all 85 first-parent units in exact Git order,
  with historical disposition kept separate from current verification.
- The registers contain 77 initial surfaces, 59 historical decisions (55 signed
  and four authority-pending), 14 resolved findings, and all 75 historical raw
  reports mapped exactly once.
- The four pilots are verified by production-path tests for preset field
  completeness, persisted translation dispatch, Responses request ownership,
  and portable reroll candidates through all supported `.risu` codecs.

## Locked Planning Decisions

- The fork point and behavioral sync cursor remain separate authorities.
- Upstream disposition and Fastify behavioral verification remain separate
  inventory fields.
- User-visible compatibility wins by default; exceptions require individual
  authority.
- Physical Fastify architecture may differ when observable behavior remains
  compatible.
- Unsupported/no-port behavior must be absent, explicit, or visibly diagnosed;
  silent partial behavior is not accepted.
- The workstream uses the current project taxonomy and `PLAN.md` + `status.md` +
  phase-file structure.
- Closure requires the pinned full differential; current-only goldens cannot
  substitute for baseline proof.
- No phase closes with unowned pending rows or unsigned expected differences.

## Maintenance Rules

- This file is the only live phase/slice router.
- Update it whenever a slice changes state, a finding is confirmed, a decision is
  signed, a blocker changes, or validation runs.
- Record the current Fastify verification commit for every completed domain
  phase; do not imply that the planning anchor covers later implementation.
- Keep durable rules in `PLAN.md`/`CONTRACT.md` and detailed evidence in the
  owning phase, inventory, finding, or verification file.
- Do not mark a phase complete while tests fail, a required baseline is absent,
  or a correctness gap lacks an explicit owner and revisit condition.
