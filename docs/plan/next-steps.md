# Next Steps

Date: 2026-06-07

The v3 remediation workstream is open. Phase 0, Phase 1, and Phase 2 are
complete and recorded in [`latest-verification.md`](latest-verification.md);
the next batch is Phase 3.

## Next Batch: Phase 3 (Memory Subsystem)

Defined in
[`phases/phase-3-memory-subsystem.md`](phases/phase-3-memory-subsystem.md).
Use the already-authored slices under
`phases/slices/phase-3-memory-subsystem/`.

1. M2 `summary-token-budget`: supply the tiktoken fallback cost in
   `selectPromptMemory`, proving existing `tokens: 0` rows are budgeted and
   documenting the intentional prompt-selection behavior change.
2. L15 `prefix-token-memo`: memoize immutable summarized-prefix token costs so
   unchanged rows are not re-encoded on repeated sends.
3. L16 `memory-fetch-deadline`: add default deadlines to the embed and
   summarize job AbortControllers and prove hung providers fail/retry.
4. K1 `skip-dead-embedding-decode`: skip or lazily defer embedding vector
   decode when query vectors are empty, preserving real-vector similarity.
5. Phase 3 verification refresh: gates, focused memory proofs, full
   validation, and [`latest-verification.md`](latest-verification.md).

Exit: M2, L15, L16, and K1 registered with regression tests; active-risk rows
flipped to `DONE` only with matching v3 gate proofs; focused suites and
TypeScript checks green; verification refreshed.

## After Phase 3

Phase 4 continues in order (see [`plan.md`](plan.md) Execution Cursor).
Phases 5-8 may then land independently by pain; Phase 9 closes.

## Proof Commands

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryRepository.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
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
