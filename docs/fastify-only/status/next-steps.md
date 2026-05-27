# Fastify-Only Next Steps

## Current Pickup

The Fastify-only lockdown plan is complete. Phase 7 verification closeout is archived in [phases-completed](../phases-completed/phase-7-verification-closeout-2026-05-27.md).

## Immediate Tasks

- No active migration task remains.
- For future changes near runtime, storage, proxy, bootstrap, packaging, or user-facing runtime strings, run the relevant focused tests plus the full ladder when the contract changes: `pnpm check`, `pnpm test`, `pnpm api:test`, `pnpm build`, and `pnpm smoke:fastify-browser`.
- Keep `src/ts/browserLocalSurface.test.ts` as the guard for removed service-worker, PWA share, file-handler, preload, standalone persistence, and local backup surfaces.
- Keep `src/ts/globalApi.proxy.test.ts`, `server/fastify/__tests__/static.test.ts`, and `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts` guarding removed legacy proxy and `globalThis.__NODE__` paths.

## Latest Phase 7 Verification

- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 76 files, 772 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests passed.
- `pnpm build` passed with existing build warnings for CSS `::highlight(...)`, browser-externalized modules, plugin timing, ineffective dynamic imports, and large chunks.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

## Watch Points

- Phase 2 removed `globalThis.__NODE__`; do not reintroduce it to make browser-local branches work.
- Phase 3 removed bootstrap local save-file initialization; do not reintroduce local persistence as a fallback for service worker or preload failures.
- Phase 4 removed client selection of `/proxy2`, `/proxy-stream-jobs`, and Cloudflare Pages-style hosted proxy functions.
- Phase 5 removed `public/sw.js`, PWA share/file handlers, `#share_*` handlers, `launchQueue`, `setUsingSw`, `src/preload.ts`, standalone persistence, and local backup/restore paths; do not restore them as compatibility bridges.
- Phase 6 updated README, localized runtime strings, Docker access docs, development instructions, and smoke instructions; do not reintroduce cross-platform setup language.
