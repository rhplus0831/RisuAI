# Next Steps

Date: 2026-06-06

Phases 1-7 are implemented and proof-refreshed. Phase 8 is the remaining open
fix batch.

## Completed Batch: Phase 4 (Client Clone Narrowing Ring 2)

Client clone narrowing ring 2 is complete and proof-refreshed:
M7-M10, L32-L34, L37, and K4 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 4 proof
refresh passed focused clone/rollback suites, v2 and clone-cost gates,
`pnpm test` (1202 passed / 4 skipped), `pnpm api:test` (1792 passed / 1
skipped), `pnpm client-thinning:audit`, and both TypeScript checks. See
[`latest-verification.md`](latest-verification.md).

## Completed Batch: Phase 5 (Client Render & UI)

Client render and UI work is complete and proof-refreshed:
M13, M17, and L38-L44 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 5 proof
refresh passed focused render/UI suites, render-count/script proof, parser
companion suites, both gates, `pnpm test` (1193 passed / 4 skipped),
`pnpm client-thinning:audit`, and both TypeScript checks. The repository-wide
`pnpm check` still reports the pre-existing 14-error baseline. See
[`latest-verification.md`](latest-verification.md).

## Completed Batch: Phase 6 (Bridges, Lifecycle & Network)

Bridge, lifecycle, and network work is complete and proof-refreshed:
M11, M12, M14, L35, L36, and L45-L47 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 6 proof
refresh passed focused bridge/lifecycle/network suites, v2 and clone-cost
gates, `pnpm test` (1185 passed / 4 skipped), `pnpm api:test` (1792 passed /
1 skipped), `pnpm client-thinning:audit`, and both TypeScript checks. The
repository-wide `pnpm check` still reports the pre-existing 14-error baseline.
See [`latest-verification.md`](latest-verification.md).

## Completed Batch: Phase 7 (Opt-In Subsystems)

Opt-in subsystem stability work is complete and proof-refreshed:
M15, M16, M18-M22, L48-L59, and K3 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 7 proof
refresh passed focused translate/UI/TTS/MCP/file-import suites, parent phase
validation snippets, both gates, `pnpm test` (1212 passed / 4 skipped),
`pnpm api:test` (1792 passed / 1 skipped), `pnpm client-thinning:audit`, and
both TypeScript checks. See [`latest-verification.md`](latest-verification.md).

## Next Batch: Phase 8 (Server Jobs, Memory & Import Bounds)

Server job, memory, import/export, and outbound bounds are defined in
[`phases/phase-8-server-bounds.md`](phases/phase-8-server-bounds.md):

1. L1 generation deadline bounds:
   make durable and non-durable generation deadlines configurable or sliding
   without killing active streams.
2. L2/L17 terminal retention sweeps:
   prune terminal finalization retry rows and memory jobs while preserving
   live work.
3. L15 SQLite WAL synchronous mode:
   set `PRAGMA synchronous = NORMAL` after WAL and document the durability
   trade-off.
4. L18-L22 memory worker and embedding bounds:
   drain productive ticks promptly, scope failure cascades, share summary
   reads, enforce chunk ceilings, and make contextual split policy observable.
5. L23-L29 import/export and asset bounds:
   batch JSON-card asset persists, clean up failed appends, open bundle assets
   at stream time, use atomic legacy storage writes, remove the extra JSON
   import clone, and cap Realm `.charx` downloads.
6. L27/L30/L31 outbound bounds:
   add hub abort/deadline handling, dedupe cold Vertex token exchanges, and
   apply a default proxy deadline.
7. Phase 8 verification refresh:
   refresh gates, focused server proofs, full validation, and latest
   verification.

## Guardrails

- Preserve success-path outputs: generation responses, DB durability, memory
  jobs, import/export bytes, outbound responses, and realm import behavior stay
  semantically identical unless a slice explicitly calls out a bug fix.
- Bounds must be observable in tests: cache sizes, listener counts, retry
  counts, deadlines, byte caps, queue depth, and log suppression should have
  focused assertions.
- L22 is the scheduled semantic correction for contextual embedding budget
  sizing; it needs explicit tests and documentation.
- Hub/proxy timeout fixes should surface bounded error results and release
  resources; they should not convert hangs into silent success.
- Do not schedule L12 or the v1 carry-over gates (v1-L4, v1-L7, v1-L26,
  v1-U2) without evidence or owner approval.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches shared
client state, import/export bytes, MCP transport behavior, or client/server
contracts.

Phase 8 focused runs:

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/durableGeneration.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts \
  server/fastify/__tests__/memoryEmbedJobHandler.test.ts \
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/backups.test.ts \
  server/fastify/__tests__/risuSaveBundleExportRoute.test.ts \
  server/fastify/__tests__/proxy.test.ts
```

Full proof set:

```bash
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Optional metric review: deadline/retention/byte-cap/queue-depth assertions in
focused tests, `RISU_PROTOCOL_METRICS=1` only when a change crosses the server
send path, and `pnpm analyze:db <input>` for static corpus comparisons.

## Current Validation Caveats

Phases 4-7 are green for focused suites, both gates, full root/API proof where
recorded, client-thinning audit, and TypeScript checks. The remaining nonzero
baseline in [`latest-verification.md`](latest-verification.md) is `pnpm check`
retaining its 14-error svelte-check baseline.
