# Stability And Performance Remediation Status (V3)

Date: 2026-06-07

This is the entry router for the open v3 remediation workstream. Read this
first, then [`next-steps.md`](next-steps.md) for the active task batch.

## Snapshot

- Plan state: OPEN. Phase 0 is complete; Phase 1 is the next batch.
- Findings covered: 89 confirmed v3 audit findings (1 high, 9 medium, 56 low,
  23 informational) plus the K1-K4 known-overlap residuals/re-opens.
- Scheduled IDs: H1, M1-M9, L1-L56, and K1-K4 — all `PENDING` in
  [`active-risk-analysis.md`](active-risk-analysis.md). Phase 0 only landed
  test/doc scaffolding and measurement; it fixed no findings.
- Gated IDs: unchanged from the v2 closeout — `v2-L12`, the v1 carry-overs
  (v1-L4, v1-L7, v1-L26, v1-U2), and the
  [`../archive/leftover.md`](../archive/leftover.md) evidence gates. I1-I23
  need no action (ride notes in the risk analysis).
- Standing gates: `src/ts/__tests__/fixCompletenessGate.test.ts` stays live
  against the archived v1 docs,
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` stays live against the
  archived v2 docs, and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` stays live against this
  plan. All three must keep passing throughout this plan.
- Current proof: fresh Phase 0 baseline on 2026-06-07. See
  [`latest-verification.md`](latest-verification.md).

## Phase Router

- [Phase 0](phases/phase-0-baseline-and-gate.md): complete. v3 gate
  scaffold, send-path clone-count probe, terminal-frame helper, baseline
  refresh. No runtime change.
- [Phase 1](phases/phase-1-high-and-send-path.md): pending — NEXT. H1
  abort-contract guard, M4 append fast-path, M5 field-scoped send rollback.
- [Phase 2](phases/phase-2-command-surface-scoping.md): pending. Command
  surface scoping (M1, M3, L11-L14, K2).
- [Phase 3](phases/phase-3-memory-subsystem.md): pending. Memory budget +
  per-send memory cost (M2, L15, L16, K1).
- [Phase 4](phases/phase-4-server-lifecycle-and-transport.md): pending.
  Shutdown, deadlines, cancel, transport (M9, L2, L4, L5, L17-L20, L56).
- [Phase 5](phases/phase-5-client-write-path-correctness.md): pending.
  Bridge state machine, unload flush, guard repairs (M8, L21, L23-L27,
  L34-L37).
- [Phase 6](phases/phase-6-reactive-amplification-and-render.md): pending.
  Reactive amplification + render costs (M6, L22, L28-L33).
- [Phase 7](phases/phase-7-assembly-and-trigger-hot-paths.md): pending.
  Server assembly/trigger hot paths (L1, L3, L6-L10, K3).
- [Phase 8](phases/phase-8-client-interpreters-plugins-media.md): pending.
  Client interpreters, plugins, MCP, media (M7, L38-L55, K4).
- [Phase 9](phases/phase-9-verification-budgets.md): pending. v3 gate
  completeness, closing verification run, archive move, gate repoint.

## Maintenance Rules

- Keep `status.md` and `next-steps.md` as the navigation entry points; update
  both when a phase opens or closes.
- Keep phase summaries in `phases/`; author concrete task scope in
  `phases/slices/[phase]/` when the phase opens.
- Keep the [`active-risk-analysis.md`](active-risk-analysis.md) tables
  machine-readable (`| ID | ... |` rows, `PENDING`/`DONE` markers); flip a
  row to `DONE` only together with its gate registration — registry and
  risk-map must move in the same commit.
- Every landed fix keeps a regression test and (from Phase 0 on) a v3 gate
  entry; refresh [`latest-verification.md`](latest-verification.md) after
  each proof run.
- Preserve broad loaders/snapshots for true full-corpus consumers. Narrow
  only the hot path.
- Re-check cited symbols before editing. Audit line numbers drift; symbol
  names are the durable anchor; the audit's verifier corrections are part of
  the spec.
- Do not schedule `v2-L12` or the v1 carry-over gates without evidence or
  owner approval; do not re-open v3 R1-R5, v2 R1-R13, or v1's R-set.
