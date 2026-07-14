# Server/Client Protocol Stability And Performance (ARCHIVED 2026-06-02)

Date: 2026-06-02

> **ARCHIVED - workstream complete.** Moved from `docs/plan/` to
> `.archived-docs/protocol-and-persistence/server-client-protocol/` on 2026-06-02
> after subagent verification confirmed phases 0-8 are complete. The remaining
> follow-ups are evidence-gated performance narrowing items tracked in
> [`../../deferred-work/leftover.md`](../../deferred-work/leftover.md). These docs are kept as the
> historical plan, verification record, and phase/slice detail.

This directory was the merged working plan for Fastify server/client protocol
stability and performance. The codebase remains the source of truth. Use
[`audits/fastify-side-effect-audit.md`](audits/fastify-side-effect-audit.md) for
the original risk inventory and `status.md` for the final workstream state after
later implementation commits.

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
- Historical single-page plan content and its compatibility pointer are
  consolidated in this README.

## Source Anchors

- [`audits/fastify-side-effect-audit.md`](audits/fastify-side-effect-audit.md) -
  side-effect audit that seeded this plan.
- [`audits/server-client-ownership.md`](audits/server-client-ownership.md) -
  ownership split.
- [`audits/server-client-protocol.md`](audits/server-client-protocol.md) -
  current protocol model and prior plan inputs.
- [`../../../STRUCTURE.md`](../../../STRUCTURE.md) and
  [`../../../docs/structure/`](../../../docs/structure/)
  - present-tense code navigation.

## Former Compatibility Entry

The former one-page compatibility entry only routed readers to `status.md`,
`next-steps.md`, `plan.md`, and the phase index. Those links now live in the
read order above, so the pointer was folded into this README.
