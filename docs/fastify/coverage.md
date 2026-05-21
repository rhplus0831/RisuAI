# Test Coverage

Date: 2026-05-21

This is the coverage router. Detail per area lives in the
shards under [`coverage/`](coverage/).

## Snapshot

- Phase 4 `sendChat` characterization tests exist at
  `src/ts/process/__tests__/sendChat.fixtures.test.ts`, with 17
  fixture sets under `src/ts/process/__fixtures__/`.
- Phase 5 extraction slices add focused process tests for the helper
  modules that now sit beside the fixture harness:
  `sendChatErrors.test.ts`, `notification.test.ts`, `igp.test.ts`,
  `stage4Finalize.test.ts`, `emotionFromResponse.test.ts`,
  `charEmotionStore.test.ts`, `emotionFallbackLlm.test.ts`,
  `emotionFallbackEmbedding.test.ts`, `imggenStableDiff.test.ts`,
  `outputTrigger.test.ts`, `nonStreamResponse.test.ts`, and
  `streamResponse.test.ts`.
- Existing helper-surface tests continue to cover smaller process
  seams outside the fixture harness. Relevant current files include
  `src/ts/process/ttsHooks.test.ts`,
  `src/ts/process/request/tests/additionalParams.test.ts`,
  `src/ts/process/mcp/risuaccess/tests/modules.test.ts`, and
  `src/ts/process/files/tests/inlays.test.ts`; broader repo tests
  cover parser, media, translator, network, and source-map helpers.
- `server/fastify/__tests__/smoke.test.ts` covers the Phase 1
  Fastify foundation. `bootstrap.test.ts`, `assets.test.ts`,
  `backups.test.ts`, and `static.test.ts` cover the Phase 2
  server storage routes and static SPA serving. `proxy.test.ts`,
  `streamJobs.test.ts`, `streamJobsRoutes.test.ts`, `hub.test.ts`,
  and `legacyStorage.test.ts` cover the Phase 3 proxy / hub /
  stream-job / legacy storage surface through `pnpm api:test`.

## Where to look

| Concern                                        | Open                                                           |
| ---------------------------------------------- | -------------------------------------------------------------- |
| `sendChat` characterization fixtures (Phase 4) | [coverage/sendchat-fixtures.md](coverage/sendchat-fixtures.md) |
| Fastify route tests (Phases 1-3, 6-9)          | [coverage/server-routes.md](coverage/server-routes.md)         |
| Per-provider generation tests (Phase 6)        | [coverage/providers.md](coverage/providers.md)                 |

## Verification commands

```bash
pnpm check          # svelte-check + tsc
pnpm test           # frontend vitest (existing)
pnpm api:test       # Fastify vitest route suite
pnpm build          # production bundle
```

Run `pnpm check`, `pnpm test`, and `pnpm build` before closing a
browser-only slice. Include `pnpm api:test` for Fastify server slices.

## Maintenance

- Every fixture added to the sendChat suite gets a row in
  [`coverage/sendchat-fixtures.md`](coverage/sendchat-fixtures.md)
  with one line about what it pins.
- Every new server route gets a row in
  [`coverage/server-routes.md`](coverage/server-routes.md) once
  the route has a test.
- Every new provider in `/api/v1/generate/completion` gets a row
  in [`coverage/providers.md`](coverage/providers.md).
- Coverage rows are not deleted when work lands; they document
  what is pinned.
