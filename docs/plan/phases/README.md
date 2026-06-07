# Stability And Performance Remediation Phases (V3)

Date: 2026-06-07

This phase index routes the open v3 remediation workstream. Use these files
for phase scope, exit criteria, and slice routing. Concrete slices are
authored just-in-time under `slices/[phase]/[slice-name].md` when a phase
opens (the archived v2 slices are the template). Every finding ID is defined
in
[`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md);
the finding -> phase map is in
[`../active-risk-analysis.md`](../active-risk-analysis.md).

- Phase 0, complete (foundations; no runtime change):
  [`phase-0-baseline-and-gate.md`](phase-0-baseline-and-gate.md).
- Phase 1, complete (H1 abort contract; M4/M5 send path):
  [`phase-1-high-and-send-path.md`](phase-1-high-and-send-path.md).
- Phase 2, complete (Theme 2: command-surface scoping; M1, M3, L11-L14, K2):
  [`phase-2-command-surface-scoping.md`](phase-2-command-surface-scoping.md).
- Phase 3, complete (Theme 7: memory subsystem; M2, L15, L16, K1):
  [`phase-3-memory-subsystem.md`](phase-3-memory-subsystem.md).
- Phase 4, complete (Themes 3+9: server lifecycle, deadlines,
  transport; M9, L2, L4, L5, L17-L20, L56):
  [`phase-4-server-lifecycle-and-transport.md`](phase-4-server-lifecycle-and-transport.md).
- Phase 5, pending — NEXT (Themes 4+5: client write-path correctness; M8, L21,
  L23-L27, L34-L37):
  [`phase-5-client-write-path-correctness.md`](phase-5-client-write-path-correctness.md).
- Phase 6, pending (Theme 6: reactive amplification & render; M6, L22,
  L28-L33):
  [`phase-6-reactive-amplification-and-render.md`](phase-6-reactive-amplification-and-render.md).
- Phase 7, pending (Themes 1+8 server side: assembly & trigger hot paths;
  L1, L3, L6-L10, K3):
  [`phase-7-assembly-and-trigger-hot-paths.md`](phase-7-assembly-and-trigger-hot-paths.md).
- Phase 8, pending (Theme 8: client interpreters, plugins, media; M7,
  L38-L55, K4):
  [`phase-8-client-interpreters-plugins-media.md`](phase-8-client-interpreters-plugins-media.md).
- Phase 9, pending (verification budgets; the v3 gate, closing run, archive):
  [`phase-9-verification-budgets.md`](phase-9-verification-budgets.md).

Phases 0-4 are complete. Phase 5 is the next ordered batch; Phases 6-8 can
then land via separate branches, and Phase 9 closes the plan.

## Slice Rules

- One slice is one implementation or proof batch.
- Each slice includes scope, anchors, target shape, invariants, done
  criteria, and validation.
- Keep slices small enough to pick up from [`../next-steps.md`](../next-steps.md).
- Every fix needs a regression test: clone-cost/scoped-load/render-count for
  narrowing, behavior for bounds/correctness, terminal-frame assertions for
  cancel-path changes, round-trip for codec/export changes. Register the
  gate per [`phase-9-verification-budgets.md`](phase-9-verification-budgets.md).
- Preserve the broad path for its genuine consumer; narrow only the hot path.
- Re-verify cited line numbers by symbol before editing; the audit's verifier
  corrections (in each finding's prose) are part of the spec.
