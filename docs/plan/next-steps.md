# Next Steps

Date: 2026-06-07

The v3 remediation workstream is open. Phase 0, Phase 1, Phase 2, Phase 3,
Phase 4, Phase 5, and Phase 6 are complete and recorded in
[`latest-verification.md`](latest-verification.md). The v4-H2 Phase 4.5
hotfix is complete; use [`v4-integration-brief.md`](v4-integration-brief.md)
as the post-Phase-4 router for v4 findings that amend the remaining v3 plan.

## Completed Checkpoint: Phase 6

Closed the reactive amplification and render batch: transcript window state
resets by active chat identity; Chat and BackgroundDom parser dependencies are
narrowed; catalog/mobile lists use derived keyed helpers; lorebook and
chat-metadata watchers short-circuit unchanged work; character draft seeding
is gated; ChatBody parse-key signatures and customHTML templates are memoized
by real invalidators; `bestMatchCache` is bounded/reset; and stale BGM state
is cleared on chat/character switch. v4-H1, v4-M1, v4-L20, and v4-L22 are
recorded as Phase 6 amendment proofs only.

## Next Batch: Phase 7 (Assembly & Trigger Hot Paths)

Defined in
[`phases/phase-7-assembly-and-trigger-hot-paths.md`](phases/phase-7-assembly-and-trigger-hot-paths.md).
Slices already live under
`phases/slices/phase-7-assembly-and-trigger-hot-paths/`.

1. L1 `async-asset-reads`: move image-bearing send asset reads off the event
   loop while preserving request-scoped cache semantics.
2. L3/K3 `dispatch-clone-narrowing`: avoid dispatch-layer prompt clones and
   restoration-payload clones when default branches can reuse immutable rows.
3. v4-M4/v4-L6 `provider-parameter-conventions`: preserve disabled-parameter
   omission semantics and record the logit-bias pass/drop policy.
4. L6/L7 `per-assembly-invariants`: hoist per-message asset and lorebook
   allocation work while keeping activation output identical.
5. L8 `trigger-clone-narrowing`: skip or row-limit trigger transcript clones
   only for trigger sets without message-mutating effects.
6. L9/v4-L7 `user-regex-bounds`: bound user regex execution in trigger,
   lorebook, and customscript paths without changing legitimate regex output.
7. L10 `history-memo-chat-var-bumps`: bump the history-callback memo on every
   chat-var dirty fold.
8. Phase 7 verification refresh: gates, focused output-identity/count proofs,
   full validation, and [`latest-verification.md`](latest-verification.md).

Exit: L1, L3, L6-L10, K3, and the Phase 7 v4 riders registered with focused
proofs; active-risk rows flipped to `DONE` only with matching v3 gate proofs;
server-focused suites, client/server checks, and verification refreshed.

## Proof History

Phase 6 closed on 2026-06-07 with M6, L22, and L28-L33 registered as `DONE`,
v4-H1/v4-M1/v4-L20/v4-L22 recorded as Phase 6 amendment proofs only, the
focused Phase 6 matrix green, `pnpm test` green, `pnpm client-thinning:audit`
green, and both TypeScript checks green. Keep new Phase 7 proof entries in
[`latest-verification.md`](latest-verification.md) above the Phase 6 entry.

## After Phase 7

Phase 8 can then land by pain; Phase 9 closes.

## Proof Commands

```bash
pnpm exec vitest run \
  --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/triggers.test.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/openai.test.ts \
  server/fastify/__tests__/horde.test.ts
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
