# Next Steps

Date: 2026-06-07

The v3 remediation workstream is open. Phase 0 is complete and recorded in
[`latest-verification.md`](latest-verification.md); the next batch is Phase 1.

## Next Batch: Phase 1 (High Severity & Send Path)

Defined in
[`phases/phase-1-high-and-send-path.md`](phases/phase-1-high-and-send-path.md).
Author the slices under `phases/slices/phase-1-high-and-send-path/` when
starting; the v2 Phase 1 slices
([`../archive/audit-stability-and-performance-v2/phases/slices/phase-1-high-severity-hot-paths/`](../archive/audit-stability-and-performance-v2/phases/slices/phase-1-high-severity-hot-paths/))
are the structural template.

1. H1 `transport-abort-contract`: guard `emitProviderChunks`' abort fallthrough
   and prove durable cancel/deadline/in-loop/non-streaming abort paths with
   terminal-frame assertions.
2. M4 `send-append-fast-path`: route plain sends through the existing append
   command, keep replace for trigger-rewritten transcripts, and compare
   against the Phase 0 clone-count baseline.
3. M5 `send-rollback-field-scope`: narrow steady-state rollback to
   `lastInteraction`, retaining message-array snapshot only for the first-send
   backfill branch.
4. Phase 1 verification refresh: register gates, run focused before/after
   proof plus full validation, and refresh
   [`latest-verification.md`](latest-verification.md).

Exit: H1, M4, and M5 registered with regression tests; active-risk rows flipped
to `DONE` only with matching v3 gate proofs; focused suites and TypeScript
checks green; verification refreshed.

## After Phase 1

Phases 2-4 continue in order (see [`plan.md`](plan.md) Execution Cursor).
Phases 5-8 may then land independently by pain; Phase 9 closes.

## Proof Commands

```bash
pnpm api:test
pnpm test
pnpm exec vitest run src/ts/__tests__/sendCloneCountProbe.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Standing Caveats

- The v1/v2 gates point at `docs/archive/` and must keep passing; nothing in
  this plan may edit the archived docs.
- `pnpm check` retains its documented pre-existing svelte-check baseline
  (14 errors in 5 files at the v2 closeout); do not let it grow.
- The audit's verifier corrections (in each finding's prose) are part of the
  spec — read the finding in
  [`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md)
  before implementing its row.
