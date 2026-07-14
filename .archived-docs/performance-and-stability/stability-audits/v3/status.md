# Stability And Performance Remediation Status (V3)

Date: 2026-06-08

This is the archived entry router for the closed v3 remediation workstream.
Use it for historical phase routing and proof lookup.

## Snapshot

- Plan state: closed and archived on 2026-06-08. Phases 0-9 are complete,
  including the final verification-budget closeout and archive/repoint slice.
  The v4-H2 Phase 4.5 proxy/transport hotfix is also complete.
- Findings covered: 89 confirmed v3 audit findings (1 high, 9 medium, 56 low,
  23 informational) plus the K1-K4 known-overlap residuals/re-opens.
- Scheduled IDs: H1, M1-M9, L1-L56, and K1-K4. `H1`, `M1-M9`, `L1-L56`,
  and `K1-K4` are `DONE` in
  [`active-risk-analysis.md`](active-risk-analysis.md).
- Gated IDs: unchanged from the v2 closeout — `v2-L12`, the v1 carry-overs
  (v1-L4, v1-L7, v1-L26, v1-U2), and the
  [`../leftover.md`](../../../deferred-work/leftover.md) evidence gates. I1-I23
  need no action (ride notes in the risk analysis).
- Standing gates: `src/ts/__tests__/fixCompletenessGate.test.ts` stays live
  against the archived v1 docs,
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` stays live against the
  archived v2 docs, and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` stays live against this
  archived v3 doc set.
- Current proof: the Phase 9 closing run passed all three gates, `pnpm test`
  (1480/4), `pnpm api:test` (1950/1), `pnpm client-thinning:audit`, and both
  TypeScript checks. See [`latest-verification.md`](latest-verification.md).

## Phase Router

- [Phase 0](phases/phase-0-baseline-and-gate.md): complete. v3 gate
  scaffold, send-path clone-count probe, terminal-frame helper, baseline
  refresh. No runtime change.
- [Phase 1](phases/phase-1-high-and-send-path.md): complete. H1
  abort-contract guard, M4 append fast-path, M5 field-scoped send rollback,
  and verification refresh.
- [Phase 2](phases/phase-2-command-surface-scoping.md): complete. Command
  surface scoping (M1, M3, L11-L14, K2) and verification refresh.
- [Phase 3](phases/phase-3-memory-subsystem.md): complete. Memory budget +
  per-send memory cost (M2, L15, L16, K1) and verification refresh.
- [Phase 4](phases/phase-4-server-lifecycle-and-transport.md): complete.
  Shutdown, deadlines, cancel, transport (M9, L2, L4, L5, L17-L20, L56).
- Phase 4.5: complete. v4-H2 proxy `/fetch` framing hotfix; no v3
  active-risk IDs moved.
- [Phase 5](phases/phase-5-client-write-path-correctness.md): complete.
  Bridge state machine, unload flush, guard repairs (M8, L21, L23-L27,
  L34-L37).
- [Phase 6](phases/phase-6-reactive-amplification-and-render.md): complete.
  Reactive amplification + render costs (M6, L22, L28-L33).
- [Phase 7](phases/phase-7-assembly-and-trigger-hot-paths.md): complete.
  Server assembly/trigger hot paths (L1, L3, L6-L10, K3) plus
  v4-M4/v4-L6/v4-L7 proof riders only.
- [Phase 8](phases/phase-8-client-interpreters-plugins-media.md): complete.
  Client interpreters, plugins, MCP, media (M7, L38-L55, K4).
- [Phase 9](phases/phase-9-verification-budgets.md): complete. v3 gate
  completeness, closing verification run, archive move, and gate repoint.

## Archive Entry Points

- [`next-steps.md`](next-steps.md): closeout summary and proof commands.
- [`active-risk-analysis.md`](active-risk-analysis.md): finding-to-phase map,
  gated items, and dismissed candidates.
- [`plan.md`](plan.md): goal, invariants, prerequisites, and phase order.
- [`phases/README.md`](phases/README.md): phase index and slice rules.

## Maintenance Rules

- Keep `status.md` and `next-steps.md` as the archive navigation entry points.
- Keep phase summaries in `phases/`; keep concrete task scope in
  `phases/slices/[phase]/`.
- Keep the [`active-risk-analysis.md`](active-risk-analysis.md) tables
  machine-readable (`| ID | ... |` rows, `PENDING`/`DONE` markers); flip a
  row to `DONE` only together with its gate registration — registry and
  risk-map must move in the same commit.
- Every landed fix keeps a regression test and a v3 gate entry; future
  maintenance should keep the registry and
  [`active-risk-analysis.md`](active-risk-analysis.md) aligned, then refresh
  [`latest-verification.md`](latest-verification.md) if proof is re-run.
- Preserve broad loaders/snapshots for true full-corpus consumers. Narrow
  only the hot path.
- Re-check cited symbols before editing. Audit line numbers drift; symbol
  names are the durable anchor; the audit's verifier corrections are part of
  the spec.
- Do not schedule `v2-L12` or the v1 carry-over gates without evidence or
  owner approval; do not re-open v3 R1-R5, v2 R1-R13, or v1's R-set.
