# Phase 3: Storage Contract Cleanup

## Goal

Make Fastify storage the only supported persistence contract.

## Scope

- Remove legacy storage endpoints from `src/ts/storage/nodeStorage.ts`.
- Remove local browser persistence selection from `src/ts/storage/autoStorage.ts` when it acts as a runtime alternative.
- Update bootstrap behavior that falls back to local save-file loading.
- Ensure auth and storage failures report Fastify-backed errors instead of silently selecting local mode.
- Update storage route tests to cover the retained Fastify contract.

## Boundaries

- Do not add compatibility redirects for removed storage paths.
- Do not remove import/export utilities if they are normal Fastify-served user actions.
- Do not change `.risu` data semantics unless storage tests require an explicit schema update.

## Exit Criteria

- Client storage uses `/api/v1/storage/*` only.
- Local browser storage is not selected as an app runtime.
- Storage tests and smoke coverage pass against Fastify.

## Slice Status

### Phase 3A: Client Storage Route Collapse

Completed on 2026-05-27.

Changed files:

- `src/ts/storage/nodeStorage.ts`
- `src/ts/storage/nodeStorage.test.ts`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/status.md`
- `docs/fastify-only/phases/phase-3-storage-contract-cleanup.md`
- `docs/fastify-only/coverage/server-routes.md`

Completed work:

- Removed the legacy client route table for `/api/write`, `/api/read`, `/api/list`, `/api/remove`, `/api/crypto`, `/api/test_auth`, `/api/set_password`, and `/api/login`.
- Kept only Fastify `/api/v1/storage/*` and `/api/v1/auth/*` endpoints in `NodeStorage`.
- Removed the legacy Express remove fallback so array removals always use Fastify's hex-segment `$$` contract over `POST /api/v1/storage/remove`.
- Added focused client tests for retained storage and auth route selection.

Verification:

- `pnpm exec vitest run src/ts/storage/nodeStorage.test.ts src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts` passed.
- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/legacyStorage.test.ts` passed.
- `pnpm check` passed.
- `pnpm test` passed.
- `pnpm api:test` passed.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings.

### Phase 3B: Local App Persistence Selection

Completed on 2026-05-27.

Changed files:

- `src/ts/storage/autoStorage.ts`
- `src/ts/storage/autoStorage.test.ts`
- `src/ts/storage/opfsStorage.ts`
- `docs/fastify-only/status.md`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/phases/phase-3-storage-contract-cleanup.md`
- `docs/fastify-only/coverage/server-routes.md`
- `docs/fastify-only/removed-and-out-of-scope.md`

Completed work:

- Collapsed `AutoStorage` so app persistence always uses Fastify-backed `NodeStorage`.
- Removed OPFS and localforage selection/migration as standalone app-runtime persistence alternatives.
- Deleted `OpfsStorage` because it was only reachable from the removed app persistence selector.
- Added focused client tests that prove browser OPFS/localStorage signals do not affect app persistence selection and that reads, writes, lists, and removals delegate to one `NodeStorage` instance.

Verification:

- `pnpm exec vitest run src/ts/storage/autoStorage.test.ts src/ts/storage/nodeStorage.test.ts src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts` passed: 4 files and 16 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 74 files, 768 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings for CSS `::highlight(...)`, browser-externalized modules, plugin timing, ineffective dynamic imports, and large chunks.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

### Phase 3C: Bootstrap Fallback Cleanup

Completed on 2026-05-27.

Changed files:

- `src/ts/bootstrap.ts`
- `src/ts/bootstrap.test.ts`
- `docs/fastify-only/README.md`
- `docs/fastify-only/plan.md`
- `docs/fastify-only/status.md`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/phases/README.md`
- `docs/fastify-only/phases/phase-5-browser-local-surface-cleanup.md`
- `docs/fastify-only/phases-completed/phase-2-runtime-contract-collapse-2026-05-27.md`
- `docs/fastify-only/runtime-stages.md`
- `docs/fastify-only/coverage/server-routes.md`
- `docs/fastify-only/removed-and-out-of-scope.md`
- `docs/fastify-only/phases-completed/phase-3-storage-contract-cleanup-2026-05-27.md`

Completed work:

- Collapsed `loadWebInitialDatabase()` so it always loads the Fastify `/api/v1/bootstrap` projection.
- Removed the local save-file bootstrap fallback, backup decode fallback, and service worker registration from app startup.
- Removed startup-time local persistence maintenance calls from `loadData()`.
- Added tests proving unavailable or errored Fastify bootstrap data reports explicit errors without touching local persistence.

Verification:

- `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts` passed: 2 files and 12 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 74 files, 768 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings for CSS `::highlight(...)`, browser-externalized modules, plugin timing, ineffective dynamic imports, and large chunks.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

Next pickup:

- Continue with [Phase 4: Proxy And API Routing](../phases/phase-4-proxy-and-api-routing.md).
- Keep service worker share/import behavior, preload cleanup, and broader docs packaging for later phases unless proxy cleanup exposes a dead branch.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## References

- `src/ts/storage/nodeStorage.ts:6`
- `src/ts/storage/autoStorage.ts:28`
- `src/ts/bootstrap.ts:137`
