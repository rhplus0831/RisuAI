# Slice: v2 Gate Routing Registry

Phase: [0](../../phase-0-baseline-and-gate.md). Depends on
[`v2-gate-doc-universe.md`](v2-gate-doc-universe.md). No runtime change.

## Scope

Extend `fixCompletenessGateV2.test.ts` with the Phase 0 registry and
active-risk routing checks. At the end of this slice, every v2 ID is classified
exactly once as scheduled, intentionally gated, no-action, or dismissed.

## Anchors

- Existing v2 parser helpers from
  [`v2-gate-doc-universe.md`](v2-gate-doc-universe.md).
- `.archived-docs/performance-and-stability/stability-audits/v2/active-risk-analysis.md`
  (`| ID | phase N link | ... | PENDING |`, `gated`, and `no action`
  rows).
- v1 registry shape in `src/ts/__tests__/fixCompletenessGate.test.ts`.

## Target Shape

- Add `SCHEDULED_FIXES` entries for every scheduled v2 fix:
  H1-H3, M1-M22, L1-L11 except L12, L13-L59, and K1-K4.
- All scheduled entries are `PLANNED`, phase numbers are 1-8, and `fix`
  labels mirror the Target fix text from `active-risk-analysis.md`.
- Add `INTENTIONALLY_GATED` with L12 and a substantive owner-decision reason.
- Record the v1 carry-overs and `leftover.md` evidence gates as explanatory
  reasons only, not v2 IDs.
- Add `NO_ACTION` for I1-I18 and R1-R13 with substantive reasons.
- Parse routing/status rows for ID classes H/M/L/I/K and statuses
  `PENDING`/`DONE`; scheduled docs currently all map to `PLANNED`.

## Invariants

- Registry and docs mirror each other bidirectionally: a scheduled doc row
  missing from the registry fails, and a registry ID missing from the docs
  fails.
- Each v2 audit/dismissed ID appears in exactly one classification bucket.
- `PLANNED` registry entries do not claim `testPath`, `testName`, or
  `extraTests`.
- L12 is gated, not scheduled. I1-I18 and R1-R13 are no-action, not scheduled.

## Done Criteria

- `collectGateProblems()` or equivalent reports zero problems for the current
  all-`PENDING` docs.
- Hand-falsifying a routing row's phase in a copied/in-memory doc produces a
  phase-mismatch problem.
- Hand-falsifying L12 into a scheduled phase produces a gated/scheduled
  classification conflict.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts
```
