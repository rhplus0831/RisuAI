# Stability And Performance Remediation Status

Date: 2026-06-05

This is the entry router for the remediation workstream. Use it first, then
open only the phase or slice tied to the current task.

## Snapshot

- Plan state: closed. All scheduled phases, 0 through 8, are complete.
- Findings covered: 57 confirmed audit findings: 3 high, 14 medium, 40 low.
- Done IDs: H1-H3, M1-M14, L1-L3, L5-L25, L27-L40, U1, U4.
- Remaining non-DONE IDs: L4, L7, L26, U2 are gated on owner decision or
  `RISU_PROTOCOL_METRICS` evidence. U3 needs no action.
- Standing gate: `src/ts/__tests__/fixCompletenessGate.test.ts` keeps every
  scheduled ID registered with a regression test.
- Final proof: `pnpm test` 1132/4, `pnpm api:test` 1737/1, audit green, both
  TypeScript checks zero errors. See
  [`latest-verification.md`](latest-verification.md).

## Phase Router

- [Phase 0](phases/phase-0-baseline-foundations.md): complete. Fixture,
  server load-count harness, gate scaffold.
- [Phase 1](phases/phase-1-high-severity-hot-paths.md): complete. H1 hydration
  guard, H2 scalar chat-select snapshot, H3 stream coalescing.
- [Phase 2](phases/phase-2-server-load-narrowing.md): complete. Scoped server
  reads for assembly, commands, projections, metrics, and bulk hydration.
- [Phase 3](phases/phase-3-client-clone-narrowing.md): complete. Client
  scalar/single-row rollbacks and scoped watchers.
- [Phase 4](phases/phase-4-outbound-request-lifecycle.md): complete.
  Proxy/provider/Lua deadlines, aborts, body caps, and egress guards.
- [Phase 5](phases/phase-5-materialization-and-lifecycle.md): complete.
  Bounded inflate, asset scans, stream/job cleanup, restore/replay fixes.
- [Phase 6](phases/phase-6-memory-and-lua.md): complete. Memory batch
  bounds/fairness, scoped memory loader, Lua budget, warm pool.
- [Phase 7](phases/phase-7-memoization-and-hygiene.md): complete.
  Script/lorebook/trigger memoization, prune/delete cleanup, log removal.
- [Phase 8](phases/phase-8-verification-budgets.md): complete. Gate remains
  live as the maintenance check.

## Start Here

- [`next-steps.md`](next-steps.md): maintenance posture and proof commands.
- [`active-risk-analysis.md`](active-risk-analysis.md): finding-to-phase map,
  gated items, and dismissed candidates.
- [`plan.md`](plan.md): goal, invariants, prerequisites, and phase order.
- [`phases/README.md`](phases/README.md): phase index and slice rules.

## Maintenance Rules

- Keep `status.md` and `next-steps.md` as the navigation entry points.
- Keep phase summaries in `phases/`; keep concrete task scope in
  `phases/slices/[phase]/`.
- Every future fix needs a regression test and a Phase 8 gate entry.
- Preserve broad loaders/snapshots for true full-corpus consumers. Narrow only
  the hot path.
- Re-check cited symbols before editing. Audit line numbers drift; symbol names
  are the durable anchor.
- If a gated item becomes scheduled, update the registry and
  [`active-risk-analysis.md`](active-risk-analysis.md) together, then refresh
  [`latest-verification.md`](latest-verification.md).
