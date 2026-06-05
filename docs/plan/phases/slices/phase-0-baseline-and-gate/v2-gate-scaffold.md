# Slice: v2 Fix-Completeness Gate Scaffold

Phase: [0](../../phase-0-baseline-and-gate.md). No runtime change.

## Scope

Author `src/ts/__tests__/fixCompletenessGateV2.test.ts` as the v2 sibling of
the v1 gate, parsing the v2 plan docs and seeding every scheduled ID as
`PLANNED`. Do not touch the v1 gate (it stays frozen against
`docs/archive/audit-stability-and-performance/`).

## Anchors

- Template: `src/ts/__tests__/fixCompletenessGate.test.ts` (registry shape,
  `collectGateProblems`, doc parsers, negative self-proof).
- Docs to parse: `docs/plan/audit-stability-and-performance-v2.md`
  (finding universe) and `docs/plan/active-risk-analysis.md` (routing).

## Target Shape

- Registry: `SCHEDULED_FIXES` with every scheduled ID — H1-H3, M1-M22,
  L1-L11 (except L12), L13-L59, K1-K4 — phase numbers 1-8, all `PLANNED`.
- Exclusions: `INTENTIONALLY_GATED` = L12 (+ document the v1 carry-overs as
  reasons, not IDs — they belong to the v1 gate's universe);
  `NO_ACTION` = I1-I18 and R1-R13 with substantive reasons.
- Parser deltas vs v1: finding-universe regexes must accept `### H1 — title`
  headings (em-dash) and `| I1 |`/`| K1 |` rows; routing rows use
  `PENDING`/`DONE` markers; the dismissed set is the 13 numbered items of
  the audit's "Investigated And Dismissed" section (numbered list, not
  bullets); the audit's Known-Item Overlaps table is K1-K4's evidence
  source.
- Keep the v1 gate's invariants: PLANNED entries claim no test; DONE needs
  an existing `testPath` + contained `testName`; bidirectional doc/registry
  mirroring; a negative self-proof.

## Done Criteria

- The new gate passes with the all-`PENDING` docs as written.
- Hand-falsification checks: renaming a routing row's phase, adding a fake
  `| M23 |` row to the audit doc, or flipping a doc row to `DONE` without a
  registry flip each fails the suite.
- `pnpm test` green (the new file runs in the client suite).

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts
pnpm test
```
