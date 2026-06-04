# Stability And Performance Remediation Status

Date: 2026-06-04

This is the router for the stability/performance remediation workstream. Use it
first, then open only the phase or slice needed for the next task.

The plan is **freshly opened — nothing is implemented yet.** It schedules the
57 confirmed findings (3 high, 14 medium, 40 low) from
[`audit-stability-and-performance.md`](audit-stability-and-performance.md) into
nine phases (0-8) organized by the audit's five cross-cutting root causes.

## Current Snapshot

All findings are analyzed and routed; **no phase is implemented.** Start with
Phase 0 (foundations), then Phase 1 (the three high-severity fixes). Phases 2-7
group the mediums and lows by root cause and are largely independent. Phase 8 is
the standing fix-completeness gate.

| Phase | State | Findings | Use For |
| --- | --- | --- | --- |
| [0](phases/phase-0-baseline-foundations.md) | Not started | — | Seeded-corpus fixture, server clone-cost assertion, fix-completeness gate scaffold. No runtime change. |
| [1](phases/phase-1-high-severity-hot-paths.md) | Not started | H1, H2, H3 | Hydration whole-corpus guard; `ChatSelectionSnapshot`; streaming render coalescing. |
| [2](phases/phase-2-server-load-narrowing.md) | Not started | M1, M3, M4, M5, L1, L2, L5, L6, L10, U1 | Server stops rebuilding a broad `Database` on hot paths (Root 1). |
| [3](phases/phase-3-client-clone-narrowing.md) | Not started | M12, M13, M14, L31, L32, L33, L34, L35, L36, U4 | Client whole-corpus clone narrowing (Root 2). |
| [4](phases/phase-4-outbound-request-lifecycle.md) | Not started | M6, M8, L20, L22, L23, L24, L25 | Outbound fetch timeouts, abort propagation, egress hardening (Root 4). |
| [5](phases/phase-5-materialization-and-lifecycle.md) | Not started | M9, M10, M11, L11, L12, L13, L14, L15, L27, L28, L29, L30 | Bounded inflate/buffering + stream/job lifecycle + import robustness (Root 5). |
| [6](phases/phase-6-memory-and-lua.md) | Not started | M7, L16, L17, L18, L19, L21 | Memory batch/fairness/orphan + Lua exec budget/engine reuse. |
| [7](phases/phase-7-memoization-and-hygiene.md) | Not started | M2, L3, L8, L9, L37, L38, L39, L40 | Regex/compile memoization + redundant work + logging hygiene. |
| [8](phases/phase-8-verification-budgets.md) | Not started | (all) | Self-checking fix-completeness gate. |

## Open Risk Router

[`active-risk-analysis.md`](active-risk-analysis.md) has the full per-finding
routing (finding -> phase -> target fix), the gated exclusions, and the
dismissed list. Highlights:

- **Highest leverage:** H1 (`repository.ts:1061` `loadChatHydration` guard) is a
  one-line change that removes a whole-corpus parse from every chat-open and
  generation completion — do it first after Phase 0.
- **Most user-visible:** H3 (streaming per-token re-parse) and H2 (chat-select
  freeze in long sessions).
- **Biggest shared root:** Phase 2 (server broad-load narrowing) addresses M1,
  M3, M4, M5 and several lows with one scoped-loader/memo lever.
- **Gated (not scheduled):** L4, L7, L26, U2 stay on the
  `RISU_PROTOCOL_METRICS` evidence path or an owner decision; U3 needs no
  action; the five dismissed candidates (R1-R5 in the audit) are non-issues.

## Latest Verification

See [`latest-verification.md`](latest-verification.md). The workstream starts
from the prior-workstream green baseline (`pnpm test`, `pnpm api:test`,
`pnpm client-thinning:audit`, and both project-reference TypeScript checks
passing). Re-run and record before starting Phase 1.

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
- Every fix lands with a regression test (a clone-cost/scoped-load assertion for
  narrowing, a behavior test for a bound/correctness fix) and registers its gate
  in Phase 8's completeness map. Do not mark a slice implemented without it.
- Preserve the broad path for its genuine consumer; narrow only the hot path.
- Re-check the cited code before editing — audit line numbers drift; symbol
  names are the durable anchor.
- Update this status and the phase router after a phase changes state, and flip
  finding IDs from "scheduled" to "DONE (commit)" in
  [`active-risk-analysis.md`](active-risk-analysis.md) as they land.
