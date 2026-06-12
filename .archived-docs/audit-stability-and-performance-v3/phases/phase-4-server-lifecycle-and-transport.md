# Phase 4: Server Lifecycle, Deadlines & Transport (Themes 3+9)

Status: complete.

Goal: make the existing teardown reachable on real shutdowns, give every
remaining stream/egress path the deadline/cancel treatment the durable path
already has, bound realm import, and claim the two transport quick wins.

Findings: M9, L2, L4, L5, L17, L18, L19, L20, L56.

## Completed Slices

- [signal-handlers-app-close](slices/phase-4-server-lifecycle-and-transport/signal-handlers-app-close.md)
  (M9) — `process.once('SIGTERM'|'SIGINT')` in `index.ts`
  calling `await app.close()` (which runs the existing onClose teardown:
  settle runners, persist cancelled partials, close SQLite) with a force-exit
  timeout backstop.
- [sliding-deadlines](slices/phase-4-server-lifecycle-and-transport/sliding-deadlines.md)
  (L2, L5) — thread `RequestAbort.refresh` into `pipeStream` on activity
  frames (mirror `streamAssembly`), and create proxy stream jobs with
  `slidingDeadline: true` (the v2-L1 machinery and
  `isStreamDeadlineActivityFrame` already exist).
- [proxy-stream-cancel](slices/phase-4-server-lifecycle-and-transport/proxy-stream-cancel.md)
  (L56) — keep the client abort listener attached for the whole stream; clear
  it in `closeAndEnd()`/onclose and issue the job DELETE when the stream ends
  without a server-side terminal frame.
- [realm-egress-bounds](slices/phase-4-server-lifecycle-and-transport/realm-egress-bounds.md)
  (L17, L18) — one per-import AbortSignal (client-close + wall-clock, the
  `attachAbort`/`createHubAbort` shape) threaded into all realm fetches in
  BOTH route branches; per-asset + cumulative byte caps for JSON-card staging
  (disk staging like the charx branch); bound the dynamic `res.json()` body.
- [horde-delete-timeout](slices/phase-4-server-lifecycle-and-transport/horde-delete-timeout.md)
  (L4) — `AbortSignal.timeout` on the fire-and-forget Horde DELETE.
- [response-compression](slices/phase-4-server-lifecycle-and-transport/response-compression.md)
  (L19) — register `@fastify/compress` (new dependency) or an onSend gzip
  hook with a ~1 KiB threshold, default ON; measured ~3.1x on the reference
  DB's bootstrap JSON.
- [immutable-chunk-caching](slices/phase-4-server-lifecycle-and-transport/immutable-chunk-caching.md)
  (L20) — `maxAge: '1y', immutable: true` (or a setHeaders callback for
  `/assets/`) on the fastifyStatic registration; index.html stays uncached via
  its existing separate handlers.
- [phase-4-verification-refresh](slices/phase-4-server-lifecycle-and-transport/phase-4-verification-refresh.md)
  — gates, focused proofs, full validation, latest-verification update.

## Source Anchors

- [`../audit-stability-and-performance-v3.md`](../audit-stability-and-performance-v3.md) -
  M9, L2, L4, L5, L17, L18, L19, L20, L56.
- M9: `server/fastify/src/index.ts` (`main`), `app.ts` (onClose hook);
  `util/api-flag-dev.ts` (dev-runner SIGTERM + force-kill backstop).
- L2: `routes/generation.ts` (`pipeStream`), `requestAbort.ts`
  (`attachAbort`/`refresh`); contrast `routes/generationChat.ts`
  (`streamAssembly` refresh wiring).
- L5/L56: `routes/streamJobs.ts` (`registry.create`), `streamJobs.ts`
  (`slidingDeadline`, `refreshDeadline`, `tickGc`); client
  `src/ts/globalApi.svelte.ts` (`fetchViaProxyJobWs`, abort handler,
  `closeAndEnd`).
- L17/L18: `routes/realmImport.ts` (`fetchRealmDynamicPayload`,
  `fetchHubResource`, `streamRealmImport`, the buffered branch,
  `stageAsset`/`stagedAssets`, `res.json()`), `realmImport/characterCard.ts`
  (serial `storeAsset` calls); patterns `requestAbort.ts`,
  `routes/hub.ts` (`createHubAbort`), the charx branch's disk staging +
  `MAX_CHARX_ASSET_SIZE_BYTES`.
- L4: `generation/horde.ts` (`fireDeleteJob`).
- L19: `app.ts` (`buildApp` registrations), `routes/bootstrap.ts`;
  `@fastify/compress` registration and dependency.
- L20: `app.ts` (fastifyStatic registration); contrast `routes/assets.ts`
  (`IMMUTABLE_CACHE`).

## Implemented Shape

- M9: WAL + `synchronous=NORMAL` already makes abrupt kills crash-safe for
  committed data; the win is the cancel-persist of in-flight durable partials
  and orderly runner settling. The force-exit backstop must be shorter than
  the dev runner's SIGKILL backstop.
- Bounds are additive: L2/L5 must not kill actively-streaming generations
  (that is their whole point); L16-style reasoning applies to L17's deadline
  (realm fetches can legitimately take tens of seconds).
- L18 follows the charx shape exactly (stage to disk, per-asset cap,
  cumulative cap); data-URI assets are already bounded by the parsed body.
- L19/L20 change HTTP transport headers only (Content-Encoding,
  Cache-Control) — the command wire model is untouched. If a reverse proxy
  is assumed in some deployments, gate compression on config but default ON.
- H1 (Phase 1) already fixed the abort terminal; L56 is the client-side
  cancel DELETE for the proxy-job path specifically.

## Exit Criteria

- [x] M9: SIGTERM/SIGINT runs onClose (observable: runners settled,
      cancel-persist executed, db closed) and exits within the backstop;
      test harness proof covers close/onClose ordering and the force backstop.
- [x] L2/L5: an actively-streaming completion/proxy job survives past the
      fixed deadline while tokens flow; idle streams still die at the
      deadline.
- [x] L56: a mid-stream client cancel DELETEs the server job; the slot is
      released.
- [x] L17/L18: realm import egress aborts on client disconnect and deadline;
      oversized JSON-card assets are rejected at the cap without OOM;
      legitimate imports unchanged.
- [x] L4: the Horde DELETE cannot outlive its timeout.
- [x] L19/L20: bootstrap JSON negotiates gzip (size assertion); hashed
      chunks serve `immutable`; index.html stays uncached; byte-identical
      bodies after decompression.
- [x] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/index.test.ts \
  server/fastify/__tests__/generation.completion.test.ts \
  server/fastify/__tests__/requestAbort.test.ts \
  server/fastify/__tests__/streamJobs.test.ts \
  server/fastify/__tests__/streamJobsRoutes.test.ts \
  server/fastify/__tests__/realmImport.test.ts \
  server/fastify/__tests__/hub.test.ts \
  server/fastify/__tests__/horde.test.ts \
  server/fastify/__tests__/bootstrap.test.ts \
  server/fastify/__tests__/static.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run \
  src/ts/globalApi.proxy.test.ts \
  src/ts/network/proxyJobWs.test.ts \
  src/ts/server/realmImport.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm api:test
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
