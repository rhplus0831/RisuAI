# Stability And Performance Remediation Phases (V2)

Date: 2026-06-06

Use these files for phase scope, exit criteria, and slice routing. Concrete
slices live under `slices/[phase]/[slice-name].md` and are authored when a
phase is picked up (Phase 0's are pre-authored). Every finding ID is defined
in
[`../audit-stability-and-performance-v2.md`](../audit-stability-and-performance-v2.md);
the finding -> phase map is in
[`../active-risk-analysis.md`](../active-risk-analysis.md).

- Phase 0, complete (foundations; no runtime change):
  [`phase-0-baseline-and-gate.md`](phase-0-baseline-and-gate.md),
  [`slices/phase-0-baseline-and-gate/`](slices/phase-0-baseline-and-gate/).
- Phase 1, proof-refreshed (the three high-severity fixes: H1, H2, H3):
  [`phase-1-high-severity-hot-paths.md`](phase-1-high-severity-hot-paths.md),
  [`slices/phase-1-high-severity-hot-paths/`](slices/phase-1-high-severity-hot-paths/).
- Phase 2, complete (Root 1: server corpus-path ring 2; M5, M6, L3, L13, L14,
  L16, K1, K2):
  [`phase-2-server-corpus-ring-2.md`](phase-2-server-corpus-ring-2.md),
  [`slices/phase-2-server-corpus-ring-2/`](slices/phase-2-server-corpus-ring-2/).
- Phase 3, complete (Root 2: assembly CBS & triggers; M1-M4, L4-L11):
  [`phase-3-assembly-cbs-and-triggers.md`](phase-3-assembly-cbs-and-triggers.md),
  [`slices/phase-3-assembly-cbs-and-triggers/`](slices/phase-3-assembly-cbs-and-triggers/).
- Phase 4, complete (Root 3: client clone narrowing ring 2; M7-M10, L32-L34,
  L37, K4):
  [`phase-4-client-clone-ring-2.md`](phase-4-client-clone-ring-2.md),
  [`slices/phase-4-client-clone-ring-2/`](slices/phase-4-client-clone-ring-2/).
- Phase 5, complete (Root 4: client render & UI; M13, M17, L38-L44):
  [`phase-5-client-render-and-ui.md`](phase-5-client-render-and-ui.md).
- Phase 6, complete (Root 6: bridges, lifecycle, network; M11, M12, M14, L35,
  L36, L45-L47):
  [`phase-6-bridges-lifecycle-network.md`](phase-6-bridges-lifecycle-network.md).
- Phase 7, complete (Root 5: opt-in subsystems; M15, M16, M18-M22, L48-L59,
  K3): [`phase-7-opt-in-subsystems.md`](phase-7-opt-in-subsystems.md).
- Phase 8, complete (server jobs/memory/import bounds; L1, L2, L15, L17-L31):
  [`phase-8-server-bounds.md`](phase-8-server-bounds.md).
- Phase 9, pending (verification budgets; the v2 gate):
  [`phase-9-verification-budgets.md`](phase-9-verification-budgets.md).

Phases 4-8 are independent of each other and were landed via separate branches. Phases 1-8 have landed; Phase 9 remains the closeout batch in the current routing docs.

## Slice Rules

- One slice is one implementation or proof batch.
- Each slice includes scope, anchors, target shape, invariants, done criteria,
  and validation.
- Keep slices small enough to pick up from [`../next-steps.md`](../next-steps.md).
- Every fix needs a regression test: clone-cost/scoped-load/render-count for
  narrowing, behavior for bounds/correctness, round-trip for codec/export
  changes. Register the gate per
  [`phase-9-verification-budgets.md`](phase-9-verification-budgets.md).
- Preserve the broad path for its genuine consumer; narrow only the hot path.
- Re-verify cited line numbers by symbol before editing; the audit's verifier
  corrections (in each finding's prose) are part of the spec.
