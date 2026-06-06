# Next Steps

Date: 2026-06-07

The v3 remediation workstream is open. Phase 0, Phase 1, Phase 2, and Phase 3
are complete and recorded in
[`latest-verification.md`](latest-verification.md); the next batch is Phase 4.

## Next Batch: Phase 4 (Server Lifecycle, Deadlines & Transport)

Defined in
[`phases/phase-4-server-lifecycle-and-transport.md`](phases/phase-4-server-lifecycle-and-transport.md).
Author slices under `phases/slices/phase-4-server-lifecycle-and-transport/`
as they open.

1. M9 `signal-handlers-app-close`: wire SIGTERM/SIGINT to `app.close()` and
   prove shutdown runs the existing onClose cleanup within a backstop.
2. L2/L5 `sliding-deadlines`: refresh deadlines for active generation/proxy
   streams while preserving idle timeout behavior.
3. L56 `proxy-stream-cancel`: keep cancel listeners live for proxy streams and
   DELETE the server job when the client cancels before a terminal frame.
4. L17/L18 `realm-egress-bounds`: add per-import abort/deadline handling and
   JSON-card asset size caps without regressing legitimate imports.
5. L4 `horde-delete-timeout`: bound the fire-and-forget Horde DELETE.
6. L19/L20 transport quick wins: gzip bootstrap responses and serve immutable
   hashed chunks while keeping `index.html` uncached.
7. Phase 4 verification refresh: gates, focused proofs, full validation, and
   [`latest-verification.md`](latest-verification.md).

Exit: M9, L2, L4, L5, L17-L20, and L56 registered with regression tests;
active-risk rows flipped to `DONE` only with matching v3 gate proofs; focused
suites, API tests, and TypeScript checks green; verification refreshed.

## Proof History

Phase 3 closed on 2026-06-07 with M2, L15, L16, and K1 registered as `DONE`,
the focused memory proof suite green, `pnpm api:test` green, the v3 gate green,
and both TypeScript checks green. Keep new Phase 4 proof entries in
[`latest-verification.md`](latest-verification.md) above the Phase 3 entry.

## After Phase 4

Phases 5-8 may then land independently by pain; Phase 9 closes.

## Proof Commands

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/requestAbort.test.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/hub.test.ts
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
