# Next Steps

Date: 2026-06-07

The v3 remediation workstream is open. Phase 0, Phase 1, Phase 2, Phase 3,
Phase 4, Phase 5, Phase 6, and Phase 7 are complete and recorded in
[`latest-verification.md`](latest-verification.md). The v4-H2 Phase 4.5
hotfix is complete; use [`v4-integration-brief.md`](v4-integration-brief.md)
as the post-Phase-4 router for v4 findings that amend the remaining v3 plan.

## Completed Checkpoint: Phase 7

Closed the server assembly and trigger hot-path batch: stored asset bytes are
resolved asynchronously with request-scoped cache semantics; default dispatch
and restoration paths avoid redundant prompt clones; provider disabled
parameters keep the SPA omission convention; logit-bias pass/drop policy is
recorded; per-assembly asset/lorebook invariants are hoisted; non-mutating
trigger phases avoid transcript clones while mutating phases stay isolated;
trigger/imported regex execution is bounded; and chat-var writes invalidate
the history memo. `L1`, `L3`, `L6-L10`, and `K3` are `DONE`. v4-M4, v4-L6,
and v4-L7 are Phase 7 proof riders only, not v3 `DONE` IDs.

## Next Batch: Phase 8 (Client Interpreters, Plugins & Media)

Defined in
[`phases/phase-8-client-interpreters-plugins-media.md`](phases/phase-8-client-interpreters-plugins-media.md).
Slices already live under
`phases/slices/phase-8-client-interpreters-plugins-media/`.

1. L38-L41 `client-interpreter-budgets`: port server trigger/Lua execution
   budgets to client manual trigger paths and keep editDisplay access ids
   bounded.
2. L42 `tokenizer-and-cache-caps`: bound the Google tokenization cache.
3. v4-L24 through v4-L29 `translator-subsystem-hygiene`: memoize/bound
   translator work and keep v4-L30 owned by Phase 5.
4. M7/L43/L44 `plugin-lifecycle`: pair plugin cleanup, provider-store reset,
   guest listener/observer teardown, and RPC log gating.
5. L45-L48 `mcp-lifecycle-and-caps`: lazy/deduped MCP setup plus SSE/PDF read
   caps and aborts.
6. L49 `file-attach-await`: await Hypa text extraction before prompt assembly.
7. L50-L55/K4 `media-leaks-and-logs`: remove payload logs and prove object
   URL, AudioContext, synthesizer, pdf.js, whisper, and stableDiff cleanup.
8. Phase 8 verification refresh: gates, focused lifecycle/cap proofs, full
   validation, and [`latest-verification.md`](latest-verification.md).

Exit: M7, L38-L55, K4, and bounded Phase 8 v4 riders registered with focused
proofs; active-risk rows flipped to `DONE` only with matching v3 gate proofs;
client-focused suites, audits, the client-lib TypeScript check, and
verification refreshed.

## Proof History

Phase 7 closed on 2026-06-07 with L1, L3, L6-L10, and K3 registered as
`DONE`, v4-M4/v4-L6/v4-L7 recorded as Phase 7 proof riders only, the focused
server matrix green, `pnpm api:test` green, the v3 gate green, and both
TypeScript checks green. Keep new Phase 8 proof entries in
[`latest-verification.md`](latest-verification.md) above the Phase 7 entry.

## After Phase 8

Phase 9 closes the plan.

## Proof Commands

```bash
pnpm exec vitest run \
  src/ts/process/mcp/mcplib.test.ts \
  src/ts/process/mcp/mcp.test.ts \
  src/ts/process/files/multisend.test.ts \
  src/ts/translator/translator.html.test.ts \
  src/ts/translator/translator.cache.test.ts \
  src/ts/process/postGeneration/runStage4.test.ts \
  src/ts/process/stableDiff.test.ts \
  src/ts/process/tts.test.ts \
  src/ts/process/processzip.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
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
