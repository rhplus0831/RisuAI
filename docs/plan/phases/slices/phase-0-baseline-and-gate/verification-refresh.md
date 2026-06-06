# Slice: Phase 0 Verification Refresh

Phase: [0](../../phase-0-baseline-and-gate.md). Depends on all earlier Phase 0
slices. No runtime change.

## Scope

Re-run the full proof set after the v3 gate, send clone-count probe, and
terminal-frame helper land, then record the refreshed Phase 0 baseline in
[`../../../latest-verification.md`](../../../latest-verification.md). This is a
proof-only slice, not an implementation slice.

## Anchors

- `docs/plan/latest-verification.md`.
- Phase 0 outputs:
  `src/ts/__tests__/fixCompletenessGateV3.test.ts`,
  the send clone-count probe test, and the terminal-frame helper smoke test.
- TypeScript workflow from `AGENTS.md`.
- Full Phase 0 validation list in
  `docs/plan/phases/phase-0-baseline-and-gate.md`.

## Target Shape

- Add a dated Phase 0 run-log entry to `latest-verification.md`.
- Record command outcomes and relevant baseline details:
  v1/v2/v3 gate status, send clone-count fixture size and observed counts,
  terminal-frame helper smoke status, `pnpm test`, `pnpm api:test`,
  `pnpm client-thinning:audit`, and both TypeScript checks.
- If a command is not run, record the reason and leave the matching Phase 0
  parent exit criterion incomplete.
- If a command fails, keep the failure visible in the verification log with any
  focused diagnostic command that was run afterward.

## Invariants

- Do not change runtime code in this slice.
- Do not silently replace a failed proof with a narrower command; focused
  commands may be added as diagnostics, but the full proof status must remain
  visible.
- Run the client-lib TypeScript build before the strict Fastify server check.
- The v3 active-risk rows should remain `PENDING` after Phase 0 unless a later
  implementation slice has actually landed and registered proof.

## Done Criteria

- `latest-verification.md` has a fresh Phase 0 baseline entry.
- The Phase 0 parent exit criteria can be checked off against recorded results.
- The v3 gate is green with every scheduled ID `PLANNED`.
- Baseline clone-count numbers are recorded for Phase 1 M4/M5 comparison.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGate.test.ts src/ts/__tests__/fixCompletenessGateV2.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
