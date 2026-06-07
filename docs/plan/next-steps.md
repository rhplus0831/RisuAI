# Next Steps

Date: 2026-06-08

The v3 remediation workstream is open. Phase 0, Phase 1, Phase 2, Phase 3,
Phase 4, Phase 5, Phase 6, Phase 7, and Phase 8 are complete and recorded in
[`latest-verification.md`](latest-verification.md). The v4-H2 Phase 4.5
hotfix is complete; use [`v4-integration-brief.md`](v4-integration-brief.md)
as the post-Phase-4 router for v4 findings that amend the remaining v3 plan.

## Completed Checkpoint: Phase 8

Closed the client interpreters, plugin/MCP lifecycle, files, and media batch:
manual trigger and client Lua execution are budgeted; Lua/access-key and
Google-token caches are bounded; translator cache/memo/fanout work is covered
as v4 proof riders; plugin cleanup/provider/listener lifecycles are paired;
MCP initialization and filesystem reads are lazy, deduped, capped, and
abortable; file attachments await text ingestion deterministically; and media
payload logs plus object URL, AudioContext, synthesizer, pdf.js, whisper, and
stableDiff cleanup are covered. `M7`, `L38-L55`, and `K4` are `DONE`.
v4-L24 through v4-L29, v4-L31, and v4-L35 through v4-L37 are Phase 8 proof
riders only, not v3 `DONE` IDs. v4-L30 remains Phase 5-owned, and v4-L38
stays out of Phase 8 without a separate auth-storage owner.

## Next Batch: Phase 9 (Verification Budgets)

Defined in
[`phases/phase-9-verification-budgets.md`](phases/phase-9-verification-budgets.md).
Slices already live under `phases/slices/phase-9-verification-budgets/`.

1. `registry-sweep`: prove every scheduled ID (`H1`, `M1-M9`, `L1-L56`,
   `K1-K4`) is `DONE` or explicitly re-gated with owner sign-off, with no
   gate/risk/audit drift.
2. `gate-self-proof-freeze`: keep the v3 negative self-proofs alive and
   confirm the v1/v2 gates stay frozen against their archives.
3. `closing-proof`: run the full closeout command set and record the final
   proof log.
4. `archive-and-repoint`: archive the closed v3 plan, repoint the v3 gate,
   and update navigation docs.

Exit: all scheduled v3 rows closed or explicitly re-gated, all three gates
green, full client/server/audit/TypeScript proof recorded, v3 plan archived,
and navigation repointed.

## Proof History

Phase 8 closed on 2026-06-08 with M7, L38-L55, and K4 registered as `DONE`,
v4-L24 through v4-L29, v4-L31, and v4-L35 through v4-L37 recorded as Phase 8
proof riders only, the focused client lifecycle/cap matrix green,
`pnpm test` green, `pnpm client-thinning:audit` green, the v3 gate green, and
the client-lib TypeScript check green. Keep new Phase 9 proof entries in
[`latest-verification.md`](latest-verification.md) above the Phase 8 entry.

## Proof Commands

```bash
pnpm exec vitest run \
  src/ts/__tests__/fixCompletenessGate.test.ts \
  src/ts/__tests__/fixCompletenessGateV2.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

## Standing Caveats

- The v1/v2 gates point at `docs/archive/`; nothing in this plan may edit the
  archived docs.
- `pnpm check` retains its documented pre-existing svelte-check baseline
  (14 errors in 5 files at the v2 closeout); do not let it grow.
- The audit's verifier corrections (in each finding's prose) are part of the
  spec — read the finding in
  [`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md)
  before implementing its row.
