# Phase 5: Browser Local Surface Cleanup

Closed on 2026-05-27.

## Goal

Remove browser-local support that implies the app can run without the Fastify server.

## Scope Closed

- Reviewed and removed service-worker share/import, image cache, and local-only behavior.
- Removed the unused preload marker path.
- Verified Phase 3 bootstrap cleanup left no reachable local save-file startup path.
- Removed UI gates and copy paths that advertised local backup and restore operation.
- Kept normal Fastify-served browser features such as static client serving and file import/export utilities.

## Changed Files

- `public/manifest.json`
- `public/sw.js`
- `src/main.ts`
- `src/preload.ts`
- `src/lib/Setting/Pages/UserSettings.svelte`
- `src/ts/browserLocalSurface.test.ts`
- `src/ts/bootstrap.test.ts`
- `src/ts/bootstrap.ts`
- `src/ts/characterCards.ts`
- `src/ts/globalApi.svelte.ts`
- `src/ts/platform.ts`
- `src/ts/storage/backup.test.ts`
- `src/ts/storage/backup.ts`
- `src/ts/storage/persistant.ts`
- `docs/fastify-only/README.md`
- `docs/fastify-only/plan.md`
- `docs/fastify-only/runtime-stages.md`
- `docs/fastify-only/status.md`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/phases/README.md`
- `docs/fastify-only/phases/phase-5-browser-local-surface-cleanup.md`
- `docs/fastify-only/phases-completed/README.md`
- `docs/fastify-only/phases-completed/phase-5-browser-local-surface-cleanup-2026-05-27.md`
- `docs/fastify-only/removed-and-out-of-scope.md`

## Phase 5A Completed Work

- Deleted `public/sw.js` so the built app no longer ships `/sw/check`, `/sw/register`, `/sw/img`, `/sw/share`, or `/tf` cache fallbacks.
- Removed PWA `share_target` and `file_handlers` entries from `public/manifest.json`.
- Removed `#share_character`, `#share_preset`, `#share_module`, and `launchQueue` import handling from `src/ts/characterCards.ts`.
- Removed the service-worker image-cache branch and `setUsingSw` from `src/ts/globalApi.svelte.ts`; Fastify asset URLs remain the server-backed path.
- Deleted the unused `src/preload.ts` localStorage marker and removed its startup call from `src/main.ts`.
- Added `src/ts/browserLocalSurface.test.ts` to guard against restoring removed service-worker, PWA share/file-handler, and preload surfaces.

## Phase 5B Completed Work

- Changed `public/manifest.json` display mode from `standalone` to `browser` so the manifest no longer advertises an install-style standalone mode.
- Removed automatic standalone/PWA storage persistence from `src/ts/bootstrap.ts`.
- Removed `isInStandaloneMode` and the iOS/Android standalone marker from `src/ts/platform.ts`.
- Deleted unused `src/ts/storage/persistant.ts`.
- Collapsed `src/ts/storage/backup.ts` to the retained Fastify server-backup creation path only.
- Removed local full backup, local partial backup, and local backup-file restore buttons from `src/lib/Setting/Pages/UserSettings.svelte`.
- Removed the local internal-backup fallback from `src/ts/globalApi.svelte.ts`; backup loading now lists and restores Fastify server backups only.
- Extended `src/ts/browserLocalSurface.test.ts` and `src/ts/storage/backup.test.ts` to guard against restoring standalone persistence and local backup/restore paths.

## Verification

- `pnpm exec vitest run src/ts/browserLocalSurface.test.ts src/ts/storage/backup.test.ts src/ts/bootstrap.test.ts` passed: 3 files and 12 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 76 files, 772 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings for CSS `::highlight(...)`, browser-externalized modules, plugin timing, ineffective dynamic imports, and large chunks.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

## Follow-Up

- Phase 6 docs and packaging closeout is archived in [phases-completed](phase-6-docs-and-packaging-closeout-2026-05-27.md).
- Phase 6 should update README, localized runtime strings, Docker, compose, env docs, and smoke instructions so they describe Fastify as the only supported runtime.
- Keep Fastify-served drag/drop import/export utilities unless they become a replacement for Fastify storage or bootstrap.

## References

- `src/ts/browserLocalSurface.test.ts:1`
- `src/ts/storage/backup.ts:1`
- `src/lib/Setting/Pages/UserSettings.svelte:1`
- `src/ts/bootstrap.ts:58`
- `src/ts/globalApi.svelte.ts:1747`
