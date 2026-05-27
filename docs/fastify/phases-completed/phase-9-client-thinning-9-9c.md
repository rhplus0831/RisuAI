# Phase 9-9c - Server-Backed Storage-Write Audit

Date: 2026-05-26

## Summary

- Extended the Fastify-served browser smoke with a storage-write audit hook.
  The hook records IndexedDB/localForage entry points, OPFS directory access,
  and legacy `/api/v1/storage/*` traffic while the real SPA performs startup,
  bootstrap/event subscription, a runtime settings command, server completion,
  memory reads, `.risu` export, bundle export, asset upload, and asset read.
- Seeded the browser smoke database with the current exportable Phase 9 shape
  so the server `.risu` and bundle export routes can run inside the integrated
  browser path.
- Rechecked the known local storage candidates from the 9-6 gates. The
  remaining localForage users are runtime-only browser caches, plugin sandbox
  storage, legacy local mode storage paths, or helpers already covered by explicit
  server-backed unsupported behavior.
- No production code changes or new command endpoints were required.

## Boundaries

- Legacy local mode and local browser storage behavior is unchanged.
- Runtime-only browser caches remain local when they are not authoritative
  server database state.
- Detailed `.risu` import/export, asset-reference, generation, and memory
  behavior remains covered by the focused API and fixture suites; the browser
  smoke is the integrated server-backed tripwire.
- Manual Fastify web and legacy local mode verification remains 9-9d.

## Verification

- `pnpm smoke:fastify-browser`
  - passed; built the SPA and ran the Playwright browser smoke through
    Fastify startup, bootstrap/events, runtime settings command, server
    completion, memory reads, `.risu` export, bundle export, asset upload/read,
    projection refresh, and the no-local-storage-write audit. Build emitted
    existing CSS `::highlight`, browser externalization, plugin-timing,
    ineffective dynamic import, and chunk-size warnings.
- `pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
  - passed; command selected the full client suite: 65 files, 734 tests passed,
    4 skipped.
- `pnpm exec vitest run src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/stage4Finalize.test.ts src/ts/process/__tests__/sendChatContext.test.ts`
  - passed: 5 files, 56 tests.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/risuSaveAssetReferences.test.ts server/fastify/__tests__/risuSaveCodec.test.ts`
  - passed: 2 files, 23 tests.
- `pnpm api:test -- server/fastify/__tests__/risuSaveBundleExportRoute.test.ts server/fastify/__tests__/risuSaveExportRoute.test.ts server/fastify/__tests__/risuSaveImportRoute.test.ts server/fastify/__tests__/bootstrap.test.ts`
  - passed; command selected the full Fastify API suite: 68 files and 1162
    tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-9d, manual Fastify web and legacy local mode verification.
- Keep 9-9e for final Phase 9 docs and status closeout after the manual checks
  are recorded.
