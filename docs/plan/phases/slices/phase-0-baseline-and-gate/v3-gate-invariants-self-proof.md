# Slice: v3 Gate Invariants + Self-Proof

Phase: [0](../../phase-0-baseline-and-gate.md). Depends on
[`v3-gate-routing-registry.md`](v3-gate-routing-registry.md). No runtime
change.

## Scope

Finish the v3 gate by adding the standing invariants future fix slices rely on:
`DONE` proof validation, duplicate/missing coverage detection, and negative
self-proofs for mutated docs and drifted registries.

## Anchors

- V2 invariant implementation in
  `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- Current v3 registry and parser helpers from
  [`v3-gate-routing-registry.md`](v3-gate-routing-registry.md).
- Phase 0 failure conditions in
  `docs/plan/phases/phase-0-baseline-and-gate.md`.

## Target Shape

- `DONE` scheduled entries require an existing repo-root-relative `testPath`
  and a `testName` string contained in that file.
- `extraTests` are validated the same way as the primary proof.
- `PLANNED` entries are rejected if they include any proof fields.
- `collectGateProblems()` accepts explicit doc-text and registry overrides so
  self-proof tests can mutate copied docs or cloned registries without editing
  files on disk.
- Negative self-proofs cover at least these cases:
  adding a fake audit/routing row, removing a scheduled row, changing a routing
  row's phase, flipping a doc row to `DONE` without matching registry proof,
  and registering a `DONE` test name that does not exist in its file.
- Add the final standing test that the live docs and live registry currently
  produce zero gate problems with all scheduled entries `PLANNED`.

## Invariants

- The v3 gate remains a sibling of the v1/v2 gates; the three registries and
  doc roots never mix.
- Current Phase 0 state remains all scheduled entries `PLANNED`.
- The self-proof tests must not rely on writing temporary plan files to disk.
- A `DONE` active-risk row without a registered, existing regression proof is a
  hard failure.
- Risk-map drift against the audit findings index is a hard failure.

## Done Criteria

- The v3 gate fails loudly for missing IDs, unknown IDs, phase/status drift,
  duplicate classification, stale `DONE` test names, and fake new audit IDs.
- The focused v1+v2+v3 gate command is green.
- `pnpm test` includes the new v3 gate and is green.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts
pnpm test
```
