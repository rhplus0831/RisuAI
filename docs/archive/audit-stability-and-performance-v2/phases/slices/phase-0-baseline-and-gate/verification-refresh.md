# Slice: Phase 0 Verification Refresh

Phase: [0](../../phase-0-baseline-and-gate.md). Depends on the v2 gate and
render-count baseline slices. No runtime change.

## Scope

Re-run the full proof set after the Phase 0 gate and render probe land, then
record the refreshed baseline in
[`../../../latest-verification.md`](../../../latest-verification.md). This is a
proof-only slice, not an implementation slice.

## Anchors

- `docs/archive/audit-stability-and-performance-v2/latest-verification.md`.
- Phase 0 outputs:
  `src/ts/__tests__/fixCompletenessGateV2.test.ts`,
  `src/ts/__tests__/renderCostHarness.ts`, and the render baseline test.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Add a dated Phase 0 run-log entry to `latest-verification.md`.
- Record command outcomes and relevant counts:
  v2 gate status, render-count baseline N/counts, `pnpm test`,
  `pnpm api:test`, `pnpm client-thinning:audit`, and both TypeScript checks.
- If a command is not run, record the reason and leave Phase 0 exit criteria
  incomplete.

## Invariants

- Do not change runtime code in this slice.
- Do not silently replace a failed proof with a narrower command; focused
  commands may be added as diagnostics, but the full proof status must remain
  visible.
- Run the client-lib TypeScript build before the strict Fastify server check.

## Done Criteria

- `latest-verification.md` has a fresh Phase 0 baseline entry.
- The Phase 0 parent exit criteria can be checked off against the recorded
  results.

## Validation

```bash
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
