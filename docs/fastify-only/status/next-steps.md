# Fastify-Only Next Steps

## Current Pickup

Continue [Phase 5: Browser Local Surface Cleanup](../phases/phase-5-browser-local-surface-cleanup.md). Phase 4 proxy and API routing is complete and archived in [phases-completed](../phases-completed/phase-4-proxy-and-api-routing-2026-05-27.md).

## Immediate Tasks

1. Review `public/sw.js`, `src/preload.ts`, and share/import flows for browser-local behavior that implies standalone local support.
2. Keep Fastify-served user actions that are normal import/export utilities, but remove runtime fallback behavior that replaces Fastify storage or bootstrap.
3. Update focused tests before deleting browser-local branches, especially where service worker or preload behavior affects file/image loading.
4. Keep README, localized runtime strings, Docker, env docs, and broader packaging closeout for Phase 6 unless Phase 5 directly changes the same surface.
5. Update this file after the next Phase 5 slice closes.

## Latest Phase 4 Verification

- `pnpm exec vitest run src/ts/globalApi.proxy.test.ts` passed: 1 file and 2 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 75 files, 770 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

## Phase 5 Verification To Record

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## Watch Points

- Phase 2 removed `globalThis.__NODE__`; do not reintroduce it to make browser-local branches work.
- Phase 3 removed bootstrap local save-file initialization; do not reintroduce local persistence as a fallback for service worker or preload failures.
- Phase 4 removed client selection of `/proxy2`, `/proxy-stream-jobs`, and Cloudflare Pages-style hosted proxy functions.
- Include localized app strings in the docs and packaging closeout, not only markdown files.
