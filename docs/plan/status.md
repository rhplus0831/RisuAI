# Stability And Performance Remediation Status

Date: 2026-06-04

This is the entry router for the remediation workstream. Use it first, then open
only the phase or slice needed for the task.

The plan schedules 57 confirmed findings (3 high, 14 medium, 40 low) from
[`audit-stability-and-performance.md`](audit-stability-and-performance.md) across
Phases 0-8. Phase 0 is complete (foundations only); no runtime fix has landed
yet. Next is Phase 1 (H1 first).

## Current Snapshot

All findings are routed. Phase 0 is done; start Phase 1. Phases 2-7 group the
mediums/lows by root cause. Phase 8 is the standing gate (its scaffold is
live).

- [Phase 0](phases/phase-0-baseline-foundations.md) — COMPLETE. Shared
  large-corpus fixture + `assertScopedLoadOnHotPath` server load-count harness
  (with the H1/U1 breadth detections as self-proof), and the fix-completeness
  gate scaffold (`src/ts/__tests__/fixCompletenessGate.test.ts`, all ids
  `PLANNED`, doc-mirrored, fails on drift). No runtime change.
- [Phase 1](phases/phase-1-high-severity-hot-paths.md) — not started. H1, H2,
  H3: hydration guard, chat-selection snapshot, streaming coalescing.
- [Phase 2](phases/phase-2-server-load-narrowing.md) — not started. M1, M3, M4,
  M5, L1, L2, L5, L6, L10, U1: server broad-load narrowing.
- [Phase 3](phases/phase-3-client-clone-narrowing.md) — not started. M12-M14,
  L31-L36, U4: client clone narrowing.
- [Phase 4](phases/phase-4-outbound-request-lifecycle.md) — not started. M6,
  M8, L20, L22-L25: outbound timeouts, abort, egress hardening.
- [Phase 5](phases/phase-5-materialization-and-lifecycle.md) — not started.
  M9-M11, L11-L15, L27-L30: bounded materialization and lifecycle cleanup.
- [Phase 6](phases/phase-6-memory-and-lua.md) — not started. M7, L16-L19, L21:
  memory fairness and Lua budget/engine reuse.
- [Phase 7](phases/phase-7-memoization-and-hygiene.md) — not started. M2, L3,
  L8, L9, L37-L40: memoization and hygiene.
- [Phase 8](phases/phase-8-verification-budgets.md) — standing; scaffold live
  (`fixCompletenessGate.test.ts`). Flip ids `PLANNED` -> `DONE` (registry +
  [`active-risk-analysis.md`](active-risk-analysis.md) together) as fixes land.

## Open Risk Router

[`active-risk-analysis.md`](active-risk-analysis.md) has the full per-finding
routing (finding -> phase -> target fix), the gated exclusions, and the
dismissed list. Highlights:

- Highest leverage: H1 (`loadChatHydration` guard) removes a whole-corpus parse
  from chat-open and generation completion. Do it first after Phase 0.
- Most user-visible: H3 streaming parse coalescing and H2 chat-select snapshot.
- Biggest shared root: Phase 2 server broad-load narrowing.
- Gated (not scheduled): L4, L7, L26, U2 stay on the
  `RISU_PROTOCOL_METRICS` evidence path or an owner decision; U3 needs no
  action; the five dismissed candidates (R1-R5 in the audit) are non-issues.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). Re-run and record the
baseline before starting Phase 1.

## Start Here

- Use [`next-steps.md`](next-steps.md) to choose the next task and proof command.
- Use [`active-risk-analysis.md`](active-risk-analysis.md) for the per-finding
  routing and the gated/dismissed exclusions.
- Use [`plan.md`](plan.md) for the goal, prerequisites, invariants, and phase
  order.
- Use [`phases/README.md`](phases/README.md) for all phase docs.

## Maintenance Rules

- Keep `status.md` and `next-steps.md` as the navigation entry points.
- Keep phase summaries in `phases/`; keep concrete task scope in
  `phases/slices/[phase]/`.
- Every fix needs a regression test and a Phase 8 gate entry. Do not mark a
  slice implemented without both.
- Preserve the broad path for its genuine consumer; narrow only the hot path.
- Re-check the cited code before editing — audit line numbers drift; symbol
  names are the durable anchor.
- Update this status and the phase router after a phase changes state, and flip
  finding IDs from "scheduled" to "DONE (commit)" in
  [`active-risk-analysis.md`](active-risk-analysis.md) as they land.
