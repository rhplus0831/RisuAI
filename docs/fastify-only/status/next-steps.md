# Fastify-Only Next Steps

## Current Pickup

Continue [Phase 6: Docs And Packaging Closeout](../phases/phase-6-docs-and-packaging-closeout.md). Phase 5 browser local surface cleanup is archived in [phases-completed](../phases-completed/phase-5-browser-local-surface-cleanup-2026-05-27.md).

## Immediate Tasks

1. Update `README.md` so it no longer describes a cross-platform app.
2. Update localized app strings that still mention Node self-hosting, Tauri, `__NODE__`, `/proxy2`, or other removed runtime details.
3. Fix Docker and compose port references so they match the Fastify runtime.
4. Update development and smoke instructions to use `pnpm api:dev`, `pnpm api:start`, and `pnpm smoke:fastify-browser`.
5. Keep `src/ts/browserLocalSurface.test.ts` as the guard for removed service-worker, PWA share, file-handler, preload, standalone persistence, and local backup surfaces.

## Latest Phase 5 Verification

- `pnpm exec vitest run src/ts/browserLocalSurface.test.ts src/ts/storage/backup.test.ts src/ts/bootstrap.test.ts` passed: 3 files and 12 tests.
- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 76 files, 772 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

## Phase 6 Verification To Record

- Record any additional focused command for docs, packaging, or localized-string cleanup.
- Minimum Phase 6 verification: `pnpm check`, `pnpm build`, and `pnpm smoke:fastify-browser`.

## Watch Points

- Phase 2 removed `globalThis.__NODE__`; do not reintroduce it to make browser-local branches work.
- Phase 3 removed bootstrap local save-file initialization; do not reintroduce local persistence as a fallback for service worker or preload failures.
- Phase 4 removed client selection of `/proxy2`, `/proxy-stream-jobs`, and Cloudflare Pages-style hosted proxy functions.
- Phase 5 removed `public/sw.js`, PWA share/file handlers, `#share_*` handlers, `launchQueue`, `setUsingSw`, `src/preload.ts`, standalone persistence, and local backup/restore paths; do not restore them as compatibility bridges.
- Include localized app strings in the docs and packaging closeout, not only markdown files.
