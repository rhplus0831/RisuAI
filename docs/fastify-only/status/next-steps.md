# Fastify-Only Next Steps

## Current Pickup

Continue [Phase 7: Verification Closeout](../phases/phase-7-verification-closeout.md). Phase 6 docs and packaging closeout is archived in [phases-completed](../phases-completed/phase-6-docs-and-packaging-closeout-2026-05-27.md).

## Immediate Tasks

1. Run the full verification ladder: `pnpm check`, `pnpm test`, `pnpm api:test`, `pnpm build`, and `pnpm smoke:fastify-browser`.
2. Confirm active docs and entry points still describe Fastify as the only supported runtime.
3. Confirm removed platform paths are absent from scripts, source, public docs, and user-facing runtime strings.
4. Archive Phase 7 with actual verification results, changed files, and any explicit follow-up items.
5. Keep `src/ts/browserLocalSurface.test.ts` as the guard for removed service-worker, PWA share, file-handler, preload, standalone persistence, and local backup surfaces.

## Latest Phase 6 Verification

- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

## Phase 7 Verification To Record

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## Watch Points

- Phase 2 removed `globalThis.__NODE__`; do not reintroduce it to make browser-local branches work.
- Phase 3 removed bootstrap local save-file initialization; do not reintroduce local persistence as a fallback for service worker or preload failures.
- Phase 4 removed client selection of `/proxy2`, `/proxy-stream-jobs`, and Cloudflare Pages-style hosted proxy functions.
- Phase 5 removed `public/sw.js`, PWA share/file handlers, `#share_*` handlers, `launchQueue`, `setUsingSw`, `src/preload.ts`, standalone persistence, and local backup/restore paths; do not restore them as compatibility bridges.
- Phase 6 updated README, localized runtime strings, Docker access docs, development instructions, and smoke instructions; do not reintroduce cross-platform setup language.
