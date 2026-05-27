# Phase 5: Browser Local Surface Cleanup

## Goal

Remove browser-local support that implies the app can run without the Fastify server.

## Scope

- Review `public/sw.js` for share/import, image cache, and local-only behavior.
- Review `src/preload.ts` for web versus non-web branches.
- Verify the Phase 3 bootstrap cleanup left no reachable local save-file startup path.
- Update UI copy or gates that still advertise local-only operation.
- Keep browser features only when they are normal Fastify-served client features.

## Boundaries

- Do not remove static client serving.
- Do not remove browser APIs that are required by the Fastify-served UI.
- Do not leave service worker routes that imply standalone local data ownership.

## Exit Criteria

- The built client requires Fastify-backed startup.
- Service worker and preload code no longer preserve removed platform behavior.
- Smoke coverage exercises the retained browser path through Fastify.

## Slice Status

### Phase 5A: Service Worker And Preload Cleanup

Completed on 2026-05-27.

Changed files:

- `public/manifest.json`
- `public/sw.js`
- `src/main.ts`
- `src/preload.ts`
- `src/ts/browserLocalSurface.test.ts`
- `src/ts/bootstrap.test.ts`
- `src/ts/characterCards.ts`
- `src/ts/globalApi.svelte.ts`
- `docs/fastify-only/README.md`
- `docs/fastify-only/status.md`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/phases/phase-5-browser-local-surface-cleanup.md`
- `docs/fastify-only/removed-and-out-of-scope.md`

Completed work:

- Deleted `public/sw.js` so the built app no longer ships `/sw/check`, `/sw/register`, `/sw/img`, `/sw/share`, or `/tf` cache fallbacks.
- Removed PWA `share_target` and `file_handlers` entries from `public/manifest.json`.
- Removed `#share_character`, `#share_preset`, `#share_module`, and `launchQueue` import handling from `src/ts/characterCards.ts`.
- Removed the service-worker image-cache branch and `setUsingSw` from `src/ts/globalApi.svelte.ts`; Fastify asset URLs remain the server-backed path.
- Deleted the unused `src/preload.ts` localStorage marker and removed its startup call from `src/main.ts`.
- Added `src/ts/browserLocalSurface.test.ts` to guard against restoring removed service-worker, PWA share/file-handler, and preload surfaces.

Verification:

- `pnpm exec vitest run src/ts/browserLocalSurface.test.ts src/ts/bootstrap.test.ts` passed: 2 files and 10 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 76 files, 772 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings for CSS `::highlight(...)`, browser-externalized modules, plugin timing, ineffective dynamic imports, and large chunks.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

Next pickup:

- Continue Phase 5 by auditing UI copy and gates that imply standalone browser-local operation.
- Keep Fastify-served drag/drop import/export utilities unless they become a replacement for Fastify storage or bootstrap.
- Leave README, localized strings, Docker, compose, and broader packaging cleanup for Phase 6 unless the next Phase 5 slice directly touches the same surface.

## Verification

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## References

- `src/ts/browserLocalSurface.test.ts:1`
- `src/ts/bootstrap.ts:137`
