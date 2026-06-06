# Latest Verification

Date: 2026-06-06

This is the maintained proof-command log for the v3 workstream. Update it
after each change to a narrowed or bounded path.

## Current State

- Plan state: open; no phase started. All scheduled rows (`H1`, `M1-M9`,
  `L1-L56`, `K1-K4`) are `PENDING` in
  [`active-risk-analysis.md`](active-risk-analysis.md).
- Gate state: the v1 gate (`src/ts/__tests__/fixCompletenessGate.test.ts`)
  and the v2 gate (`fixCompletenessGateV2.test.ts`) are live against their
  archives. The v3 gate (`fixCompletenessGateV3.test.ts`) does not exist yet
  — Phase 0 authors it.
- Tree: clean at `ad07004ba` (the v2 Phase 9 archive commit) plus this plan
  directory.

## Inherited Baseline (v2 Phase 9 Closing Run, 2026-06-06)

Recorded in the v2 archive
([`../archive/audit-stability-and-performance-v2/latest-verification.md`](../archive/audit-stability-and-performance-v2/latest-verification.md))
at the same tree this plan starts from:

- `pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts`:
  passed, 2 files / 26 tests.
- `pnpm test`: passed, 1312 passed / 4 skipped.
- `pnpm api:test`: passed, 1846 passed / 1 skipped.
- `pnpm client-thinning:audit`: passed.
- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- `pnpm check`: pre-existing 14-error svelte-check baseline in 5 files
  (documented; unrelated).

## Audit-Time Check (2026-06-06, v3 audit session)

Run at `ad07004ba` during the v3 audit:

- `pnpm exec tsc -p tsconfig.client-lib.json`: zero errors.
- `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`: zero errors.
- Full suites were not re-run during the audit (read-only); the inherited v2
  closing run above is the authoritative full baseline at this tree. Phase 0
  re-runs and re-records the full set.
