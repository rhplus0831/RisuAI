# Slice: v3 Gate Doc Universe Parser

Phase: [0](../../phase-0-baseline-and-gate.md). No runtime change.

## Scope

Create the first, passing version of
`src/ts/__tests__/fixCompletenessGateV3.test.ts` with only the v3 plan doc
readers and ID-universe parsers. This slice proves the gate can identify the
complete v3 universe before registry routing, `DONE` proof checks, or
phase/status mirroring are added.

## Anchors

- Template: `src/ts/__tests__/fixCompletenessGateV2.test.ts` (doc-root
  constants, parser helpers, sorted ID helpers, self-check style).
- Current v3 audit:
  `docs/plan/audit-stability-and-performance-v3.md`.
- Current v3 routing source:
  `docs/plan/active-risk-analysis.md`.
- Parent phase plan:
  `docs/plan/phases/phase-0-baseline-and-gate.md`.

## Target Shape

- New test file: `src/ts/__tests__/fixCompletenessGateV3.test.ts`.
- Parser helpers collect the v3 audit universe from the plan docs:
  H1, M1-M9, L1-L56, and I1-I23 from the audit findings index / headings;
  K1-K4 from the active-risk Known-Overlap Residuals table; R1-R5 from the
  audit dismissed-candidates section.
- H/M/L/I collection accepts heading forms with hyphen, double-hyphen, or
  em-dash title separators and machine-readable table rows such as `| H1 |`.
- K1-K4 collection keeps the active-risk labels while recognizing that the
  audit's Known-Item Overlaps section is evidence, not a second ID namespace.
  Prior-audit IDs mentioned in prose (`v1-*`, `v2-*`) must never become v3 IDs.
- Active-risk table parsing recognizes ID classes `H`, `M`, `L`, `I`, and `K`
  with statuses `PENDING` and `DONE`. This slice only parses those markers; it
  does not yet enforce registry status.
- Tests assert the exact ID counts and sorted ranges:
  1 high, 9 medium, 56 low, 23 informational, 4 known-overlap residuals, and
  5 dismissed candidates.

## Invariants

- The v3 gate is a sibling of the v1/v2 gates. Do not touch
  `src/ts/__tests__/fixCompletenessGate.test.ts` or
  `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- The v3 gate points at `docs/plan/`, not `docs/archive/`; Phase 9 owns the
  eventual archive repoint.
- No production-code changes and no runtime instrumentation.
- This slice does not seed `SCHEDULED_FIXES`, `INTENTIONALLY_GATED`, or
  `NO_ACTION`; it only creates parser foundations that later slices extend.

## Done Criteria

- The new v3 gate test file exists and passes its parser-universe assertions.
- A fake new scheduled ID, such as `| M10 |`, in an in-memory parser test is
  recognized as doc drift by the helper.
- A prior-audit prose reference, such as `v2-L12`, is ignored by v3 ID
  collection unless it appears in the intentional legacy-gate context parser.
- The v1 and v2 gates still pass unchanged.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
```
