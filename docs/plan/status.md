# Stability And Performance Remediation Status (V2)

Date: 2026-06-05

This is the entry router for the v2 remediation workstream. Use it first, then
open only the phase or slice tied to the current task.

## Snapshot

- Plan state: open. No phase has started; Phase 0 is next.
- Findings covered: 102 confirmed v2 audit findings (3 high, 22 medium,
  59 low, 18 informational) plus the K1-K4 known-overlap residuals.
- Scheduled IDs (all `PENDING`): H1-H3, M1-M22, L1-L11 (except L12),
  L13-L59, K1-K4.
- Gated IDs: L12, plus the v1 carry-overs (v1-L4, v1-L7, v1-L26, v1-U2) and
  the `leftover.md` evidence gates. I1-I18 need no action.
- Standing v1 gate: `src/ts/__tests__/fixCompletenessGate.test.ts` stays live
  against the archived v1 docs. Phase 0 adds the v2 gate.
- Baseline carried from the v1 close: `pnpm test` 1132/4, `pnpm api:test`
  1737/1, audit green, both TypeScript checks zero errors. See
  [`latest-verification.md`](latest-verification.md).

## Phase Router

- [Phase 0](phases/phase-0-baseline-and-gate.md): next. v2 gate scaffold,
  render-count probe, baseline refresh. No runtime change.
- [Phase 1](phases/phase-1-high-severity-hot-paths.md): pending. H1 trigger
  budget/abort, H2 chat-create narrowing, H3 remount decoupling.
- [Phase 2](phases/phase-2-server-corpus-ring-2.md): pending. Server
  corpus-path ring 2 (M5, M6, L3, L13, L14, L16, K1, K2).
- [Phase 3](phases/phase-3-assembly-cbs-and-triggers.md): pending. Assembly
  CBS/trigger costs (M1-M4, L4-L11).
- [Phase 4](phases/phase-4-client-clone-ring-2.md): pending. Client clone
  narrowing ring 2 (M7-M10, L32-L34, L37, K4).
- [Phase 5](phases/phase-5-client-render-and-ui.md): pending. Client render,
  editor, and UI costs (M13, M17, L38-L44).
- [Phase 6](phases/phase-6-bridges-lifecycle-network.md): pending. Bridge
  echo guards, lifecycle, network (M11, M12, M14, L35, L36, L45-L47).
- [Phase 7](phases/phase-7-opt-in-subsystems.md): pending. Translate/TTS/
  MCP/file-import stability (M15, M16, M18-M22, L48-L59, K3).
- [Phase 8](phases/phase-8-server-bounds.md): pending. Server jobs, memory,
  import/export, outbound bounds (L1, L2, L15, L17-L31).
- [Phase 9](phases/phase-9-verification-budgets.md): pending. v2 gate
  completeness and the closing verification run.

## Start Here

- [`next-steps.md`](next-steps.md): the next task batch and proof commands.
- [`active-risk-analysis.md`](active-risk-analysis.md): finding-to-phase map,
  gated items, and dismissed candidates.
- [`plan.md`](plan.md): goal, invariants, prerequisites, and phase order.
- [`phases/README.md`](phases/README.md): phase index and slice rules.

## Maintenance Rules

- Keep `status.md` and `next-steps.md` as the navigation entry points.
- Keep phase summaries in `phases/`; keep concrete task scope in
  `phases/slices/[phase]/`.
- Every fix needs a regression test and a Phase 9 gate entry; flip the
  registry and [`active-risk-analysis.md`](active-risk-analysis.md) together,
  then refresh [`latest-verification.md`](latest-verification.md).
- Preserve broad loaders/snapshots for true full-corpus consumers. Narrow only
  the hot path.
- Re-check cited symbols before editing. Audit line numbers drift; symbol
  names are the durable anchor.
- Do not schedule L12 or the v1 carry-over gates without evidence or owner
  approval; do not re-open R1-R13.
