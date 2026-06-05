# Slice: v2 Gate Invariants + Self-Proof

Phase: [0](../../phase-0-baseline-and-gate.md). Depends on
[`v2-gate-routing-registry.md`](v2-gate-routing-registry.md). No runtime
change.

## Scope

Finish the v2 gate by adding the standing invariants that future fix slices
will rely on: `DONE` test validation, duplicate/missing coverage detection,
and negative self-proofs for doc/registry drift.

## Anchors

- v1 invariant implementation in `src/ts/__tests__/fixCompletenessGate.test.ts`.
- Current v2 registry and parser helpers from
  [`v2-gate-routing-registry.md`](v2-gate-routing-registry.md).

## Target Shape

- `DONE` entries require an existing repo-root-relative `testPath` and a
  `testName` string contained in that file.
- `extraTests` are validated the same way as the primary test.
- `PLANNED` entries are rejected if they include any test proof fields.
- `collectGateProblems()` accepts explicit doc-text overrides so self-proof
  tests can mutate copied docs without editing real plan files.
- Negative self-proofs cover at least these cases:
  adding a fake `| M23 |` audit/routing row,
  changing a routing row's phase,
  flipping a doc row to `DONE` without the matching registry flip.

## Invariants

- The v2 gate remains a sibling of the v1 gate; the two registries and doc
  roots never mix.
- Current Phase 0 state remains all scheduled entries `PLANNED`.
- The self-proof tests must not rely on editing files on disk.

## Done Criteria

- The v2 gate fails loudly for missing IDs, phase/status drift, duplicate
  classification, stale `DONE` test names, and fake new audit IDs.
- The focused v1+v2 gate command is green.
- `pnpm test` is green with the new v2 gate included in the client suite.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts
pnpm test
```
