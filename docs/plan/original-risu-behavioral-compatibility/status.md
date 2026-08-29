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
- Current phase: Phase 0 — cursors, contract, inventory, and pilot.
- Active slice: [Phase 0 baseline and pilot](phases/slices/phase-0-cursors-contract-and-inventory/phase-0-baseline-and-pilot.md).
- Planning audit anchor: `1933c43ff7b4d35b57b0852013d95f3881a8cb28`.
- Compatibility baseline: `71c476e9c86263fe907105b011ca4dde0a619d66`.
- Behavioral sync cursor: `f3f0242fba297d82e0efcc2c31ca1428569b70f2`.
- Toolchain observed at opening: Node `v24.19.0`; pnpm `11.23.0`.
- Opening worktree state: clean.
- Full differential prerequisite: blocked locally because
  `/home/codex/risu-baseline-71c476e9c` is absent. Phase 0 must establish the
  reproducible preparation procedure; this does not weaken the closure gate.
- Current-only compatibility state: not run by this planning slice.
- Confirmed findings: none in this new ledger yet. Historical findings are source
  material until imported and re-verified.
- Open maintainer decisions: none in this new ledger yet. Historical decisions
  remain authoritative where individually signed and must be imported with IDs.
- Next action: execute the Phase 0 baseline-and-pilot slice, starting with prior
  decision/upstream-disposition import and baseline-worktree reproducibility.

## Phase Router

| Phase | Status | Outcome |
| ---: | --- | --- |
| [0. Cursors, contract, inventory, and pilot](phases/phase-0-cursors-contract-and-inventory.md) | In progress | Freeze references, import authority, ratify schemas, and prove the method on representative boundary losses. |
| [1. Harness and assurance architecture](phases/phase-1-harness-and-assurance-architecture.md) | Pending | Make baselines, fixtures, differential/expected-difference ownership, affected selection, CI, and release gates reproducible. |
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

## Phase 0 Opening Record

- `STRUCTURE.md` records the behavioral sync cursor separately from the Git fork
  point.
- The archived upstream ledger covers `71c476e9c..f3f0242fb` and records that all
  units were dispositioned before the base advanced.
- The existing compatibility harness pins the fork-point commit and hard-coded
  baseline worktree path, but the worktree is not currently present.
- The existing current-only harness is available without external prerequisites;
  the full differential remains outside `test:all`.
- Prior compatibility, data-loss, upstream-sync, and test-effectiveness audit
  records are historical evidence, not automatically current findings.

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
