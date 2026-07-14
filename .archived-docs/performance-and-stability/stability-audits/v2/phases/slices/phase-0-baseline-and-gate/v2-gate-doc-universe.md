# Slice: v2 Gate Doc Universe Parser

Phase: [0](../../phase-0-baseline-and-gate.md). No runtime change.

## Scope

Create the first, passing version of
`src/ts/__tests__/fixCompletenessGateV2.test.ts` with only the v2 plan doc
readers and ID-universe parsers. This slice proves the gate can identify the
complete v2 universe before any registry or phase/status mirroring is added.

## Anchors

- Template: `src/ts/__tests__/fixCompletenessGate.test.ts` (root/doc reader
  pattern, sorted ID helpers, focused self-check style).
- Audit source:
  `.archived-docs/performance-and-stability/stability-audits/v2/audit-stability-and-performance-v2.md`.
- Routing source for K labels and cross-check shape:
  `.archived-docs/performance-and-stability/stability-audits/v2/active-risk-analysis.md`.

## Target Shape

- New test file: `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- Parser helpers collect the v2 gate universe from the plan docs:
  H1-H3, M1-M22, L1-L59, and I1-I18 from the audit doc; K1-K4 from the
  active-risk Known-Overlap Residuals table.
- H/M/L/I collection accepts both `### H1 - title` / `### H1 — title`
  headings and machine-readable index/table rows such as `| H1 |`.
- K1-K4 collection keeps the active-risk labels while recognizing that the
  audit's Known-Item Overlaps section is the evidence source; v1 IDs mentioned
  in prose must not become v2 IDs.
- R1-R13 collection reads the audit's Investigated And Dismissed numbered list.
- Tests assert the exact ID counts and sorted ranges:
  3 high, 22 medium, 59 low, 18 informational, 4 known-overlap residuals,
  13 dismissed candidates.

## Invariants

- Do not touch `src/ts/__tests__/fixCompletenessGate.test.ts`; the v1 gate stays
  frozen against `.archived-docs/performance-and-stability/stability-audits/v1/`.
- No production-code changes.
- This slice does not seed `SCHEDULED_FIXES`, `INTENTIONALLY_GATED`, or
  `NO_ACTION`; it only creates parser foundations that later slices extend.

## Done Criteria

- The new v2 gate test file exists and passes its parser-universe assertions.
- A fake `| M23 |` row or fake `### M23` heading in an in-memory parser test
  is recognized as doc drift by the helper, even before registry checks exist.
- The v1 gate still passes unchanged.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts
```
