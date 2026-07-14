# Phase 0: Baseline & Gate

Status: complete. Foundations only; no runtime change.

Goal: the shared prerequisites for every later phase — a v2 fix-completeness
gate, a client render-count probe, and a re-confirmed green baseline.

Findings: none (infrastructure).

## Slice Review

The first two Phase 0 slices were too broad for reliable agent handoff:
`v2-gate-scaffold` mixed parser work, registry seeding, invariant design, and
negative self-proofs; `render-count-probe` mixed harness implementation,
baseline assertions, and full-suite proof logging. They are split below into
implementation-sized units plus one proof-only refresh.

## Slices

- [`v2-gate-doc-universe.md`](slices/phase-0-baseline-and-gate/v2-gate-doc-universe.md) -
  create the v2 gate file with audit/risk doc readers and ID-universe parsers.
- [`v2-gate-routing-registry.md`](slices/phase-0-baseline-and-gate/v2-gate-routing-registry.md) -
  seed scheduled/gated/no-action registries and mirror active-risk routing.
- [`v2-gate-invariants-self-proof.md`](slices/phase-0-baseline-and-gate/v2-gate-invariants-self-proof.md) -
  add `DONE` test validation, drift checks, and negative self-proofs.
- [`render-count-harness.md`](slices/phase-0-baseline-and-gate/render-count-harness.md) -
  build the test-only ReloadGUIPointer/render-parse counting helper.
- [`render-count-baseline.md`](slices/phase-0-baseline-and-gate/render-count-baseline.md) -
  assert and record the current pre-fix N-message cold re-parse baseline.
- [`verification-refresh.md`](slices/phase-0-baseline-and-gate/verification-refresh.md) -
  re-run and log the full Phase 0 proof set after the implementation slices
  land.

## Planned Shape

- The v1 gate stays frozen against
  `.archived-docs/performance-and-stability/stability-audits/v1/`; the v2 gate is a new file
  (`fixCompletenessGateV2.test.ts`) so the two registries never mix.
- The v2 gate mirrors the v1 parser with adjusted shapes, built in three
  stages: finding/dismissed universe from the v2 audit doc (`### H*/M*`
  headings, `| H*/M*/L*/I* |` index/table rows, R1-R13 numbered dismissed
  items), K1-K4 labels from `active-risk-analysis.md` with evidence in the
  audit's Known-Item Overlaps section, routing from `active-risk-analysis.md`
  (`| ID | phase N link |`, `gated`, `no action`; ID classes `H/M/L/I/K`;
  `PENDING`/`DONE` markers), then standing invariants for doc/registry drift
  and regression-test proof paths.
- The render probe is built in two stages: a reusable test harness with
  counting wrappers and cache-wipe observation, then a small baseline test that
  records current H3/M17/L40 behavior. Reuse v1 harness idioms such as
  `cloneCostHarness.ts`, `serverLoadCostHarness.test.ts`, and the
  counting-RegExp-subclass technique from the v1 Phase 7 tests.

## Exit Criteria

- [x] v2 gate universe parser: H/M/L/I/K and R ID counts are extracted from the
      v2 docs without mixing the archived v1 universe.
- [x] v2 gate registry: every scheduled ID (H1-H3, M1-M22, L1-L11 minus L12,
      L13-L59, K1-K4) is registered `PLANNED`; gated L12 and no-action
      I1-I18/R1-R13 are recorded with reasons.
- [x] v2 gate invariants: doc/registry drift self-checks pass, `DONE` test
      paths are validated, and negative self-proofs exist.
- [x] Render-count harness: a helper counts full-parse invocations across a
      simulated `ReloadGUIPointer` bump on N mounted messages and observes
      cache wipe behavior.
- [x] Render-count baseline: the pre-fix baseline (N parses per bump, caches
      wiped) is asserted and recorded.
- [x] Baseline re-run recorded in
      [`../latest-verification.md`](../latest-verification.md): v2 gate,
      render-count baseline, `pnpm test`, `pnpm api:test`,
      `pnpm client-thinning:audit`, both TypeScript checks.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts
pnpm exec vitest run src/ts/__tests__/renderCountBaseline.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
