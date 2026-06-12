# Phase 0: Baseline & V3 Gate

Status: complete.

Goal: land the shared prerequisites before any runtime fix. No runtime change
in this phase; everything is test/doc scaffolding and measurement.

Findings: none (foundations for all scheduled IDs).

## Completed Slices

Authored under `slices/phase-0-baseline-and-gate/`; the v2 Phase 0 slices were
the template
([`../../audit-stability-and-performance-v2/phases/slices/phase-0-baseline-and-gate/`](../../audit-stability-and-performance-v2/phases/slices/phase-0-baseline-and-gate/)).

- [v3-gate-doc-universe](slices/phase-0-baseline-and-gate/v3-gate-doc-universe.md)
  — define the doc set the gate parses (this plan's
  `active-risk-analysis.md` tables + the audit's findings index), the ID
  classes (`H/M/L/I/K`), and the `PENDING`/`DONE` markers.
- [v3-gate-routing-registry](slices/phase-0-baseline-and-gate/v3-gate-routing-registry.md)
  — the registry seeding every scheduled v3 ID (`H1`, `M1-M9`, `L1-L56`,
  `K1-K4`) as `PLANNED`, with `extraTests` multi-proof support (the v2 gate's
  shape).
- [v3-gate-invariants-self-proof](slices/phase-0-baseline-and-gate/v3-gate-invariants-self-proof.md)
  — negative self-proofs: mutated-doc and drifted-registry fixtures must fail
  the gate.
- [send-clone-count-probe](slices/phase-0-baseline-and-gate/send-clone-count-probe.md)
  — count `cloneJsonValue`/`structuredClone` invocations across one simulated
  plain send (client), for the M4/M5 before/after proof.
- [terminal-frame-assertion-helper](slices/phase-0-baseline-and-gate/terminal-frame-assertion-helper.md)
  — collect SSE/job frames and assert kind/order, for the H1 durable-cancel
  proof.
- [verification-refresh](slices/phase-0-baseline-and-gate/verification-refresh.md)
  — run the full proof set and record the Phase 0 baseline in
  [`../latest-verification.md`](../latest-verification.md).

## Source Anchors

- v1 gate: `src/ts/__tests__/fixCompletenessGate.test.ts` (archive-pointed).
- v2 gate: `src/ts/__tests__/fixCompletenessGateV2.test.ts` (archive-pointed;
  the structural template for the v3 gate).
- Existing harnesses to re-baseline: the server load-count harness and the
  client render-count probe from the v1/v2 waves.

## Planned Shape

- The v3 gate is a sibling, not a replacement: all three gates run in
  `pnpm test`. The v1/v2 gates keep pointing at `.archived-docs/`; Phase 9
  repointed the v3 gate to this archive, as v2's Phase 9 did.
- Gate failure conditions: unknown or missing scheduled ID, `DONE` risk-map
  row without a registered (and existing) regression test, registry vs
  risk-map drift, risk-map vs audit findings-index drift.
- Probes are test-only instrumentation; no production code change.

## Exit Criteria

- [x] v3 gate green with every scheduled ID `PLANNED`; negative self-proofs
      in place.
- [x] Send-path clone-count probe and terminal-frame helper landed test-only.
- [x] Existing v1/v2 gates and full proof set still green.
- [x] Phase 0 baseline recorded in
      [`../latest-verification.md`](../latest-verification.md).

Closed on 2026-06-07 with no runtime change and no active-risk rows flipped.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
