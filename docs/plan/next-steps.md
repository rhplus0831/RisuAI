# Next Steps

Date: 2026-06-07

The v3 remediation workstream is open. Phase 0 and Phase 1 are complete and
recorded in [`latest-verification.md`](latest-verification.md); the next batch
is Phase 2.

## Next Batch: Phase 2 (Command-Surface Scoping)

Defined in
[`phases/phase-2-command-surface-scoping.md`](phases/phase-2-command-surface-scoping.md).
Use the already-authored slices under
`phases/slices/phase-2-command-surface-scoping/`.

1. M1 `send-persist-chat-scoped-read`: wire `chatScopedRead` into
   `persistAssemblyMutations` for non-var-write sends and prove the event
   parent id.
2. M3 `settings-scoped-read`: add the settings-only mutation read for
   settings and prompt-settings command routes, with broad fallback on the
   pre-extraction edge.
3. L11 `collection-scoped-reads`: add collection-scoped reads for preset,
   persona, loadout, plugin, global-lorebook, and translator-preset routes.
4. L12 `drop-validate-only-normalization`: preserve target-row validation and
   remove discarded corpus-wide normalization passes.
5. L13 `plugin-storage-skip-load`: use `skipDatabaseLoad` on the single-key
   plugin-storage PUT/DELETE routes.
6. L14 `single-lorebook-hydration-scope`: read one character row for single
   lorebook hydration.
7. K2 `proxy-hub-single-auth`: remove the redundant in-handler auth check
   while keeping 401 behavior unchanged.
8. Phase 2 verification refresh: gates, load-count proofs, full validation,
   and [`latest-verification.md`](latest-verification.md).

Exit: M1, M3, L11-L14, and K2 registered with regression tests; active-risk
rows flipped to `DONE` only with matching v3 gate proofs; focused suites and
TypeScript checks green; verification refreshed.

## After Phase 2

Phases 3-4 continue in order (see [`plan.md`](plan.md) Execution Cursor).
Phases 5-8 may then land independently by pain; Phase 9 closes.

## Proof Commands

```bash
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/serverLoadCostHarness.test.ts server/fastify/__tests__/commandMutationReadNarrowing.test.ts
pnpm api:test
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
