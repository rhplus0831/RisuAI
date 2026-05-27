# Fastify-Only Next Steps

## Current Pickup

Continue [Phase 5: Browser Local Surface Cleanup](../phases/phase-5-browser-local-surface-cleanup.md). Phase 5A service worker and preload cleanup is complete; Phase 4 proxy and API routing is archived in [phases-completed](../phases-completed/phase-4-proxy-and-api-routing-2026-05-27.md).

## Immediate Tasks

1. Audit UI copy and gates for messages that still imply standalone browser-local operation.
2. Keep Fastify-served user actions that are normal import/export utilities, but remove runtime fallback behavior that replaces Fastify storage or bootstrap.
3. Use `src/ts/browserLocalSurface.test.ts` as the guard for removed service-worker, PWA share, file-handler, and preload surfaces.
4. Keep README, localized runtime strings, Docker, env docs, and broader packaging closeout for Phase 6 unless Phase 5 directly changes the same surface.
5. Close Phase 5 only after the remaining browser-local affordance audit is complete.

## Latest Phase 5A Verification

- `pnpm exec vitest run src/ts/browserLocalSurface.test.ts src/ts/bootstrap.test.ts` passed: 2 files and 10 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 76 files, 772 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

## Phase 5 Verification To Record

- Record any additional focused command for the next Phase 5 slice.
- Re-run the full ladder before moving Phase 5 to `phases-completed`: `pnpm check`, `pnpm test`, `pnpm api:test`, `pnpm build`, and `pnpm smoke:fastify-browser`.

## Watch Points

- Phase 2 removed `globalThis.__NODE__`; do not reintroduce it to make browser-local branches work.
- Phase 3 removed bootstrap local save-file initialization; do not reintroduce local persistence as a fallback for service worker or preload failures.
- Phase 4 removed client selection of `/proxy2`, `/proxy-stream-jobs`, and Cloudflare Pages-style hosted proxy functions.
- Phase 5A removed `public/sw.js`, PWA share/file handlers, `#share_*` handlers, `launchQueue`, `setUsingSw`, and `src/preload.ts`; do not restore them as compatibility bridges.
- Include localized app strings in the docs and packaging closeout, not only markdown files.
