# Phase 0: Audit And Baseline

Closed on 2026-05-27.

## Goal

Create a verified baseline of local and non-Fastify support before deleting code.

## Summary

Phase 0 is complete. No runtime code was changed. The repository baseline is green. Phase 1 later closed in [Phase 1: Project Surface Removal](phase-1-project-surface-removal-2026-05-27.md).

## Changed Files

- `docs/fastify-only/phases-completed/phase-0-audit-and-baseline-2026-05-27.md`
- `docs/fastify-only/phases-completed/README.md`
- `docs/fastify-only/phases/README.md`
- `docs/fastify-only/phases/phase-1-project-surface-removal.md` (later moved to `docs/fastify-only/phases-completed/phase-1-project-surface-removal-2026-05-27.md`)
- `docs/fastify-only/status.md`
- `docs/fastify-only/status/next-steps.md`
- `docs/fastify-only/status/server.md`
- `docs/fastify-only/README.md`
- `docs/fastify-only/removed-and-out-of-scope.md`

## Audit Findings

Project entry points:

- `package.json:19` still exposes `sync`, which targets `node electron/sync`.
- `package.json:20` still exposes `electron`, which targets `node electron/dist/electron`.
- `package.json:21` still exposes `hono:build`, which builds through `server/hono/src/utils/postbuild.js`.
- `server/hono/package.json:1` and `server/hono/src/node.ts:1`, `server/hono/src/bun.ts:1`, `server/hono/src/cf.ts:1` keep Hono, Node, Bun, and Cloudflare adapter surfaces.
- `server/hono/wrangler.jsonc:1` keeps a Wrangler/Cloudflare deployment surface.
- `server/hono/src/utils/postbuild.js:5` copies the Vite build into Hono and Vercel output folders.
- `server.sh:1`, `server.bat:1`, and `capacitor.config.ts:1` remain project-level launcher or native/mobile surfaces.
- `README.md:9` still describes RisuAI as a cross platform app.

Runtime gates:

- `server/fastify/src/app.ts:176` still injects `globalThis.__NODE__` and `globalThis.__FASTIFY__`.
- `server/fastify/__tests__/static.test.ts:65` asserts both globals.
- `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts:136` and `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts:137` assert both globals.
- `src/ts/platform.ts:17` through `src/ts/platform.ts:24` still models `isTauri`, `isNodeServer`, `isFastifyServer`, and `isWeb`.
- `src/preload.ts:1` still imports `isWeb` and branches on web/non-web behavior.
- `src/lang/en.ts:160` and `src/lang/en.ts:166` mention Node self-hosting, `/proxy2`, and `globalThis.__NODE__`.
- `src/lang/zh-Hant.ts:248` mentions `/proxy2`.

Storage and proxy routes:

- `src/ts/storage/nodeStorage.ts:6` keeps Fastify `/api/v1/storage/*` and legacy `/api/*` route maps.
- `src/ts/storage/nodeStorage.ts:182` still carries an Express legacy remove workaround.
- `server/fastify/src/routes/legacyStorage.ts:35` keeps Fastify storage routes under `/api/v1/storage/*`.
- `src/ts/globalApi.svelte.ts:561` through `src/ts/globalApi.svelte.ts:578` keep Fastify `/api/v1/proxy/*`, legacy node, and hosted hub proxy branches.
- `src/ts/globalApi.svelte.ts:1670` still logs fallback to `/proxy2`.
- `public/functions/proxy.js:1` and `public/functions/proxy2.js:1` remain hosted function proxy files.

Browser-local surfaces:

- `src/ts/bootstrap.ts:187` and `src/ts/bootstrap.ts:265` still contain service worker handling.
- `public/sw.js:1` remains the service worker artifact.
- `src/ts/storage/autoStorage.ts:1` through `src/ts/storage/autoStorage.ts:73` still select localforage/OPFS for non-node storage.
- `src/ts/storage/opfsStorage.ts:57` still opens `navigator.storage.getDirectory()`.
- `src/ts/process/coldstorage.svelte.ts:41` and nearby OPFS branches keep browser-local cold storage behavior.
- Several plugin, MCP, translator, memory, and inlay flows still use `localforage`; later phases should distinguish cache/tool storage from standalone app persistence before removal.

## Verification

- `pnpm check` passed. `svelte-check found 0 errors and 0 warnings`.
- `pnpm test` passed. 72 test files passed; 764 tests passed; 4 skipped.
- `pnpm api:test` passed. 68 test files passed; 1217 tests passed.
- `pnpm build` passed. Baseline warnings include CSS `::highlight(...)` pseudo-element warnings, browser-externalized Node module warnings, large chunk warnings, plugin timing warnings, and ineffective dynamic import warnings.
- `pnpm smoke:fastify-browser` passed. The build step emitted the same baseline warning classes as `pnpm build`; Playwright reported 1 passed smoke test.

## Follow-Up

- Phase 1 later removed project-level surfaces only: `server/hono`, `hono:build`, `sync`, `electron`, `server.sh`, `server.bat`, and `capacitor.config.ts`.
- Shared runtime platform code remains for later phases: `src/ts/platform.ts`, Fastify global injection, storage maps, proxy routing, bootstrap, service worker, preload, and localized runtime strings.
