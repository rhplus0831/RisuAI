# Fastify-Only Next Steps

## Current Pickup

Continue [Phase 4: Proxy And API Routing](../phases/phase-4-proxy-and-api-routing.md). Phase 3 storage contract cleanup is complete and archived in [phases-completed](../phases-completed/phase-3-storage-contract-cleanup-2026-05-27.md).

## Immediate Tasks

1. Start Phase 4 by reviewing `src/ts/globalApi.svelte.ts` proxy URL builders and call sites around `/api/v1/proxy/*`, `/proxy2`, and `/proxy-stream-jobs`.
2. Remove hosted and legacy proxy branches only after focused tests prove provider and proxy IO still route through Fastify.
3. Delete `public/functions/proxy.js` and `public/functions/proxy2.js` after no client code selects them.
4. Keep service worker, preload, share/import, localized strings, and broader packaging cleanup for later phases unless Phase 4 directly exposes a dead branch.
5. Update this file after the next Phase 4 slice closes.

## Latest Phase 3 Verification

- `pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts` passed: 2 files and 12 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 74 files, 768 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

## Phase 4 Verification To Record

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## Watch Points

- Phase 2 removed `globalThis.__NODE__`; do not reintroduce it to make storage selection work.
- Phase 3 removed bootstrap local save-file initialization; do not reintroduce local persistence as a fallback for proxy failures.
- Include localized app strings in the docs and packaging closeout, not only markdown files.
- Treat newly discovered browser-local surfaces as follow-up findings unless they block proxy cleanup.
