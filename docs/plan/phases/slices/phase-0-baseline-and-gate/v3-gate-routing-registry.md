# Slice: v3 Gate Routing Registry

Phase: [0](../../phase-0-baseline-and-gate.md). Depends on
[`v3-gate-doc-universe.md`](v3-gate-doc-universe.md). No runtime change.

## Scope

Extend `fixCompletenessGateV3.test.ts` with the Phase 0 registry and
active-risk routing checks. At the end of this slice, every v3 ID is
classified exactly once as scheduled, intentionally gated legacy context,
no-action, or dismissed.

## Anchors

- Existing v3 parser helpers from
  [`v3-gate-doc-universe.md`](v3-gate-doc-universe.md).
- `docs/plan/active-risk-analysis.md` (`| ID | Phase | Target fix | Status |`
  rows, informational no-action rows, gated / owner-decision section).
- `docs/plan/audit-stability-and-performance-v3.md` (findings index and
  dismissed candidates).
- V2 registry shape in `src/ts/__tests__/fixCompletenessGateV2.test.ts`,
  especially `extraTests` support.

## Target Shape

- Add `SCHEDULED_FIXES` entries for every scheduled v3 fix:
  H1, M1-M9, L1-L56, and K1-K4.
- All scheduled entries are `PLANNED`, phases are 1-8, and `fix` labels mirror
  the Target fix text from `active-risk-analysis.md`.
- `PLANNED` entries may carry only `id`, `phase`, `fix`, and `status`; they
  must not claim `testPath`, `testName`, or `extraTests`.
- Add `NO_ACTION` entries for I1-I23 and R1-R5 with substantive reasons.
- Record the inherited gated / owner-decision items (`v2-L12`, v1 carry-overs,
  and `../archive/leftover.md` evidence gates) as explanatory context only.
  They must not become v3 scheduled IDs.
- Preserve the v2 gate's proof shape for future phases:
  `DONE` entries support one primary `testPath` / `testName` pair plus
  `extraTests` for multi-proof fixes.

## Invariants

- Registry and docs mirror each other bidirectionally: a scheduled doc row
  missing from the registry fails, and a registry ID missing from the docs
  fails.
- Each v3 audit/dismissed ID appears in exactly one classification bucket.
- Active-risk phase numbers match the registry phase for every scheduled ID.
- A `PENDING` active-risk row maps to a `PLANNED` registry entry at Phase 0.
- I1-I23 and R1-R5 are no-action, not scheduled. Legacy gated items are context,
  not v3 IDs.

## Done Criteria

- `collectGateProblems()` or equivalent reports zero problems for the current
  all-`PENDING` scheduled docs.
- Hand-falsifying a routing row's phase in a copied/in-memory doc produces a
  phase-mismatch problem.
- Hand-falsifying an informational ID into a scheduled phase produces a
  classification-conflict problem.
- Adding an unregistered registry ID produces a registry/doc drift problem.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGate.test.ts
```
