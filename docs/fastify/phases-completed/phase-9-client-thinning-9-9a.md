# Phase 9-9a - Server-Backed Browser Smoke Harness

Date: 2026-05-26

## Summary

- Added `pnpm smoke:fastify-browser` as the repeatable browser-level Fastify
  web smoke command.
- Added `playwright.fastify-smoke.config.ts` and
  `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts`.
- The smoke builds the real SPA, starts Fastify with `dist/` as `staticRoot`
  and a temporary no-password data dir, seeds a minimal repository database,
  and opens the Fastify-served browser app in Playwright Chromium.
- The browser path verifies Fastify `__NODE__` / `__FASTIFY__` static
  injection, startup `/api/v1/bootstrap`, `/api/v1/events` subscription,
  `PATCH /api/v1/commands/settings/runtime`, and the debounced projection
  refresh after the command event.
- Added `src/ts/server/browserSmoke.ts`, a smoke-only browser hook for waiting
  on startup, reading projection snapshots, and invoking an existing typed
  settings command helper.
- Added a smoke-only `getNodeServerProxyAuth()` shortcut for no-password
  harness runs. It is gated by `VITE_FASTIFY_BROWSER_SMOKE=TRUE`.

## Boundaries

- No generation, memory, storage-write audit, or manual verification scope was
  added to this slice.
- The smoke hook is not active in normal builds; it is only installed when the
  smoke Vite flag is present.
- The smoke harness uses a temporary no-password Fastify data dir.
  Authenticated deployment behavior remains covered by existing Fastify
  auth/API tests.
- Legacy local mode and local browser storage paths remain out of scope.

## Verification

- `pnpm smoke:fastify-browser`
  - passed; build emitted existing CSS `::highlight`, browser
    externalization, plugin-timing, and chunk-size warnings.
- `pnpm test -- src/ts/bootstrap.test.ts src/ts/server/bootstrap.test.ts src/ts/server/events.test.ts src/ts/server/commands.test.ts`
  - passed; command selected the full client suite: 65 files, 734 tests passed,
    4 skipped.
- `pnpm api:test -- server/fastify/__tests__/bootstrap.test.ts server/fastify/__tests__/commands.test.ts`
  - passed; command selected the full Fastify API suite: 68 files and 1162
    tests.
- `pnpm check`
  - passed with 0 errors and 0 warnings.

## Follow-Up

- Continue with 9-9b, generation and memory fixture closeout.
- Keep `pnpm smoke:fastify-browser` as the top-level server-backed web startup
  sanity check while 9-9b and 9-9c reconcile deeper fixture and storage-write
  coverage.
