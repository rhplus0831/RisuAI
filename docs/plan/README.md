# Server/Client Protocol Stability And Performance Plan

Date: 2026-06-02

This directory is the merged working plan for Fastify server/client protocol
stability and performance. The codebase remains the source of truth. Use
`../AUDIT.md` for the original risk inventory and `status.md` for the current
state after later implementation commits.

## Read Order

1. [`status.md`](status.md) - current snapshot and navigation router.
2. [`next-steps.md`](next-steps.md) - tactical entry point for selecting the
   next coherent task batch.
3. [`active-risk-analysis.md`](active-risk-analysis.md) - current analysis of
   the remaining performance risk areas and their candidate measurement slices.
4. [`plan.md`](plan.md) - goal, sources, invariants, and phase order.
5. [`phases/README.md`](phases/README.md) - phase index.
6. [`phases/slices/`](phases/slices/) - concrete task slices under each phase.

## Canonical Detail

- Current status, active risks, and phase routing live in
  [`status.md`](status.md).
- The current analysis of active performance risks lives in
  [`active-risk-analysis.md`](active-risk-analysis.md).
- The latest maintained full or focused verification result lives in
  [`latest-verification.md`](latest-verification.md).
- Next task selection, non-goals, and proof commands live in
  [`next-steps.md`](next-steps.md).
- Phase-level scope and exit criteria live in [`phases/`](phases/).
- Slice definitions live in `phases/slices/[phase]/[slice-name].md`.
- Historical single-page plan content was merged into this structure; the old
  compatibility entry is
  [`server-client-protocol-stability-performance.md`](server-client-protocol-stability-performance.md).

## Source Anchors

- [`../AUDIT.md`](../AUDIT.md) - side-effect audit that seeded this plan.
- [`../SERVER-AND-CLIENT.md`](../SERVER-AND-CLIENT.md) - ownership split.
- [`../SERVER-AND-CLIENT-PROTOCOL.md`](../SERVER-AND-CLIENT-PROTOCOL.md) -
  current protocol model and prior plan inputs.
- [`../../STRUCTURE.md`](../../STRUCTURE.md) and [`../structure/`](../structure/)
  - present-tense code navigation.
