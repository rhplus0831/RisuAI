# Next Steps

Date: 2026-06-06

The v3 remediation workstream is open and no phase has started. The next
batch is Phase 0.

## Next Batch: Phase 0 (Baseline & V3 Gate)

Defined in [`phases/phase-0-baseline-and-gate.md`](phases/phase-0-baseline-and-gate.md).
Author the slices under `phases/slices/phase-0-baseline-and-gate/` when
starting; the v2 Phase 0 slices
([`../archive/audit-stability-and-performance-v2/phases/slices/phase-0-baseline-and-gate/`](../archive/audit-stability-and-performance-v2/phases/slices/phase-0-baseline-and-gate/))
are the template.

1. v3 gate scaffold: create `src/ts/__tests__/fixCompletenessGateV3.test.ts`
   as a sibling of the v1/v2 gates, parsing THIS directory's
   [`active-risk-analysis.md`](active-risk-analysis.md) tables (ID classes
   `H/M/L/I/K`, statuses `PENDING`/`DONE`) and a routing registry that seeds
   every scheduled v3 ID (`H1`, `M1-M9`, `L1-L56`, `K1-K4`) as `PLANNED`.
   The gate fails on: unknown/missing IDs, a `DONE` row without a registered
   regression test, registry/risk-map drift, and drift against the audit
   doc's findings index. Include the negative self-proofs the v2 gate
   established (mutated-doc fixtures must fail).
2. Measurement points: re-baseline the server load-count harness and client
   render-count probe at `ad07004ba`; add a send-path clone-count probe
   (count `cloneJsonValue`/`structuredClone` calls across one simulated
   plain send) for the Phase 1 M4/M5 proofs; add a terminal-frame assertion
   helper (collect SSE frames; assert kind/order) for the H1 proof.
3. Baseline refresh: run the full proof set below and record it in
   [`latest-verification.md`](latest-verification.md) as the Phase 0
   baseline.

Exit: gate green with all scheduled IDs `PLANNED`, probes landed test-only,
no runtime change, full proof set green.

## After Phase 0

Phases 1-4 in order (see [`plan.md`](plan.md) Execution Cursor):

- Phase 1 lands H1 (the two-line abort-contract guard + durable-cancel test)
  first — it is independent of M4/M5 and the highest-value single fix.
- Phases 5-8 may then land independently by pain; Phase 9 closes.

## Proof Commands

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
# after Phase 0 also: src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Standing Caveats

- The v1/v2 gates point at `docs/archive/` and must keep passing; nothing in
  this plan may edit the archived docs.
- `pnpm check` retains its documented pre-existing svelte-check baseline
  (14 errors in 5 files at the v2 closeout); do not let it grow.
- The audit's verifier corrections (in each finding's prose) are part of the
  spec — read the finding in
  [`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md)
  before implementing its row.
