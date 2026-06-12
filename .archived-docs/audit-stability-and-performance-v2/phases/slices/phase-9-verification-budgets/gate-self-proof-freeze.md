# Slice: Gate Self-Proof Freeze

Phase: [9](../../phase-9-verification-budgets.md). Depends on
[`registry-universe-final-sweep.md`](registry-universe-final-sweep.md). No
runtime change.

## Scope

Freeze the gate behavior that keeps the closed plan honest: the v2 negative
self-proofs still prove the checker can fail, and the v1 gate remains isolated
against its archived universe.

This slice does not update finding statuses or run the full proof set.

## Anchors

- `src/ts/__tests__/fixCompletenessGateV2.test.ts`: registry, doc parsers,
  `DONE` test validation, and negative self-proofs.
- `src/ts/__tests__/fixCompletenessGate.test.ts`: frozen v1 gate.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md).
- [`../../../../audit-stability-and-performance/`](../../../../audit-stability-and-performance/).

## Target Shape

- The v2 gate still has explicit negative self-proofs for:
  - a new audit ID with no registry classification,
  - a phase/status mismatch between the registry and risk map,
  - an ID classified in two buckets,
  - a `DONE` entry whose `testPath`, `testName`, or `extraTests` evidence is
    missing.
- The negative fixtures are in-memory or temporary copies; they do not mutate
  the real docs.
- The v1 gate still parses only
  `.archived-docs/audit-stability-and-performance/` and does not read the v2
  plan directory.
- The v2 gate still parses only the v2 docs and does not mix archived v1 IDs
  into scheduled v2 entries.

## Invariants

- Keep the v1 and v2 gate registries separate.
- Keep the negative self-proofs cheap and deterministic; no app bootstrap or
  server startup.
- Do not weaken `DONE` proof validation just to make a renamed test pass.
- If a gate constant or doc-root helper is renamed, update tests and comments
  together so archive repointing remains obvious.

## Done Criteria

- Both gate suites pass together.
- Hand-falsification coverage remains present for every listed negative class.
- The v1 gate's archive root and v2 gate's current plan root are explicit in
  code or test fixtures.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts
```
