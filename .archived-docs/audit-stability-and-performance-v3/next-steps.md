# Next Steps

Date: 2026-06-08

The v3 remediation workstream is closed and archived. There is no current
open `docs/plan/` workstream; this file remains as the historical closeout
summary and proof-command reference. Phase 0 through Phase 9 are complete and
recorded in [`latest-verification.md`](latest-verification.md). The v4-H2
Phase 4.5 hotfix is also complete.

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

## Final Batch: Phase 9 (Verification Budgets)

Defined in
[`phases/phase-9-verification-budgets.md`](phases/phase-9-verification-budgets.md).
Slices already live under `phases/slices/phase-9-verification-budgets/`.

1. `registry-sweep`: proved every scheduled ID (`H1`, `M1-M9`, `L1-L56`,
   `K1-K4`) is `DONE` or explicitly re-gated with owner sign-off, with no
   gate/risk/audit drift.
2. `gate-self-proof-freeze`: kept the v3 negative self-proofs alive and
   confirmed the v1/v2 gates stay frozen against their archives.
3. `closing-proof`: ran the full closeout command set and recorded the final
   proof log.
4. `archive-and-repoint`: archived the closed v3 plan, repointed the v3 gate,
   and updated navigation docs.

Exit: all scheduled v3 rows closed, all three gates green, full
client/server/audit/TypeScript proof recorded, v3 plan archived, and
navigation repointed.

## Proof History

Phase 9 closed on 2026-06-08 with H1, M1-M9, L1-L56, and K1-K4 registered as
`DONE`, all three fix-completeness gates green, the full client/API/audit
proof green, both TypeScript checks green, and this archive/repoint slice
complete. The final proof is recorded in
[`latest-verification.md`](latest-verification.md).

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

- The v1, v2, and v3 gates point at `.archived-docs/`.
- `pnpm check` retains its documented pre-existing svelte-check baseline
  (14 errors in 5 files at the v2 closeout); do not let it grow.
- The audit's verifier corrections (in each finding's prose) are part of the
  spec — read the finding in
  [`audit-stability-and-performance-v3.md`](audit-stability-and-performance-v3.md)
  before implementing its row.
