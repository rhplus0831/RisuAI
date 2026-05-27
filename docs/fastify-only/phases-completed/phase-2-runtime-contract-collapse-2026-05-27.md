# Phase 2: Runtime Contract Collapse

Closed on 2026-05-27.

## Goal

Replace broad platform detection with a Fastify-served client contract.

## Result

Phase 2 is complete. Fastify static serving now injects only `globalThis.__FASTIFY__`, and the client no longer exports or imports `isNodeServer`, `isTauri`, or `isWeb` from `src/ts/platform.ts`. Server-backed gates now use `isFastifyServer`; non-Fastify branches that remain are local test or later-phase cleanup paths.

## Changed Files

- `server/fastify/src/app.ts`
- `server/fastify/__tests__/static.test.ts`
- `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts`
- `server/fastify/src/prompt/cbsAdapter.ts`
- `src/preload.ts`
- `src/ts/platform.ts`
- `src/ts/bootstrap.test.ts`
- `src/ts/characterCards.ts`
- `src/ts/globalApi.svelte.ts`
- `src/ts/alert.ts`
- `src/ts/cbs.ts`
- `src/ts/parser/parser.svelte.ts`
- `src/ts/plugins/apiV3/v3.svelte.ts`
- `src/ts/process/coldstorage.svelte.ts`
- `src/ts/process/coldstorage.test.ts`
- `src/ts/process/request/openAI/requests.ts`
- `src/ts/setting/advancedSettingsData.ts`
- `src/ts/storage/autoStorage.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/storage/persistant.ts`
- `src/ts/storage/risuSave.ts`
- `src/ts/storage/risuSave.test.ts`
- `src/lib/Setting/Pages/Advanced/SettingsExportButtons.svelte`
- `src/lang/en.ts`
- `docs/fastify-only/README.md`
- `docs/fastify-only/plan.md`
- `docs/fastify-only/status.md`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/status/server.md`
- `docs/fastify-only/runtime-stages.md`
- `docs/fastify-only/architecture.md`
- `docs/fastify-only/phases/README.md`
- `docs/fastify-only/phases-completed/README.md`
- `docs/fastify-only/phases-completed/phase-2-runtime-contract-collapse-2026-05-27.md`

## Verification

- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 72 test files, 764 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 test files and 1217 tests.
- `pnpm build` passed with existing build warnings for CSS `::highlight(...)`, browser-externalized modules, plugin timing, ineffective dynamic imports, and large chunks.
- `pnpm smoke:fastify-browser` passed: 1 Playwright test.

## Follow-Up

- Continue with [Phase 3: Storage Contract Cleanup](phase-3-storage-contract-cleanup-2026-05-27.md).
- `src/ts/storage/nodeStorage.ts` still contains Fastify and legacy storage route tables; remove the legacy storage endpoints in Phase 3.
- `src/ts/bootstrap.ts` still has the local save-file fallback path for non-Fastify harnesses; remove unsupported local runtime bootstrap in Phase 3 or Phase 5 depending on storage cleanup needs.
- `src/ts/globalApi.svelte.ts` still has hosted proxy fallback URL builders for non-Fastify harnesses; remove hosted and legacy proxy paths in Phase 4.
- `public/functions/proxy.js` and `public/functions/proxy2.js` remain hosted function proxy surfaces for Phase 4 cleanup.

## Original Scope

- Collapse `src/ts/platform.ts` around the Fastify-only runtime.
- Remove `isTauri`, local-only, node-server, and generic web branches when they no longer describe supported behavior.
- Remove `globalThis.__NODE__` from Fastify static serving.
- Keep or rename a single Fastify/server-backed signal for client bootstrap.
- Update call sites that used platform checks for storage, proxy, bootstrap, or UI gating.
