# Slice: Gate Self-Proof Freeze

Phase: [9](../../phase-9-verification-budgets.md). Depends on
[`registry-sweep.md`](registry-sweep.md). No runtime change.

## Scope

Freeze the gate behavior that keeps the closed plans honest. The v3 negative
self-proofs must still prove the checker can fail, while the v1 and v2 gates
remain isolated against their archived doc roots.

This slice does not update finding statuses, implement runtime behavior, or
run the full closeout proof set.

## Anchors

- `src/ts/__tests__/fixCompletenessGateV3.test.ts`: v3 registry, doc parsers,
  `DONE` proof validation, and negative self-proofs.
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`: frozen v2 gate.
- `src/ts/__tests__/fixCompletenessGate.test.ts`: frozen v1 gate.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
- [`../../../../audit-stability-and-performance-v2/`](../../../../audit-stability-and-performance-v2/).
- [`../../../../audit-stability-and-performance/`](../../../../audit-stability-and-performance/).

## Target Shape

- The v3 gate still has explicit negative self-proofs for:
  - a new audit ID with no registry classification,
  - a phase/status mismatch between the registry and risk map,
  - an ID classified in two buckets,
  - a `DONE` entry whose `testPath`, `testName`, or `extraTests` evidence is
    missing.
- Negative fixtures use in-memory copies or temporary files; they do not mutate
  the real docs.
- The v1 gate still parses only
  `docs/archive/audit-stability-and-performance/`.
- The v2 gate still parses only
  `docs/archive/audit-stability-and-performance-v2/`.
- The v3 gate still parses the live v3 plan docs until the archive slice
  repoints it.
- All three gates can run in one command without mixing doc roots, ID
  universes, or registry constants.

## Invariants

- Keep the v1, v2, and v3 gate registries separate.
- Keep negative self-proofs cheap and deterministic; no app bootstrap, API
  server, browser, or full test suite startup.
- Do not weaken `DONE` proof validation to accommodate renamed or deleted
  tests.
- If a gate constant or doc-root helper is renamed, update tests and comments
  together so the archive repoint remains obvious.
- Do not edit production code in this slice.

## Done Criteria

- All three gate suites pass together.
- Hand-falsification coverage remains present for every listed negative class
  in the v3 gate.
- The v1 and v2 gate archive roots and the v3 live-plan root are explicit in
  code or test fixtures.
- The parent Phase 9 all-gates-green/self-proof exit criterion is ready to
  check off.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
```
