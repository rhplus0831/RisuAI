# Fastify-Only Lockdown (Closed 2026-05-27)

Condensed archive of the `docs/fastify-only/` planning workspace, which
ran as a follow-up to the Phase 0-9 migration. It removed the residual
non-Fastify runtime surfaces that the migration left in place so the
project has one production shape: Fastify serves the `/api/v1/*` API and
the built static web client.

All seven phases closed on 2026-05-27. There is no active migration
phase; the items below are history kept for auditing and archaeology.

## Goal And Scope

Collapse the project to a single supported runtime — Fastify serving the
API plus the built web client — by removing alternate server projects,
native/mobile wrappers, broad platform gates, legacy storage and proxy
endpoints, hosted functions, and standalone browser persistence.

Non-goals: no compatibility shims for Hono, Electron, Capacitor,
Cloudflare Pages Functions, legacy Node scripts, or local save-file
mode; no migrations bridging removed storage paths; the static web
client stays as the Fastify-served UI.

## Phases

- **0 Audit And Baseline.** Froze the known non-Fastify surfaces and a
  green verification baseline.
- **1 Project Surface Removal.** Deleted the `server/hono` subtree (Node,
  Bun, Cloudflare, Vercel, Wrangler, postbuild), `server.sh` /
  `server.bat`, `capacitor.config.ts`, and the Hono/Electron/sync
  package scripts.
- **2 Runtime Contract Collapse.** Removed `globalThis.__NODE__` from
  Fastify static serving and dropped `isNodeServer`, `isTauri`, and
  `isWeb` from `src/ts/platform.ts`. `globalThis.__FASTIFY__` is the
  single server-backed client signal; server gates use `isFastifyServer`.
- **3 Storage Contract Cleanup.** Removed the legacy client route table
  (`/api/write`, `/api/read`, `/api/list`, `/api/remove`, and legacy
  auth paths), leaving only `/api/v1/storage/*` and `/api/v1/auth/*`.
  Collapsed `AutoStorage` onto Fastify-backed `NodeStorage`, deleted
  `OpfsStorage`, and removed the local save-file bootstrap fallback and
  startup service-worker registration from `src/ts/bootstrap.ts`.
- **4 Proxy And API Routing.** Collapsed client proxy URL builders onto
  `/api/v1/proxy/*` only, removed the `/proxy2` and `/proxy-stream-jobs`
  hosted-hub fallbacks, and deleted the Cloudflare Pages-style hosted
  proxy functions `public/functions/proxy.js` and `proxy2.js`.
- **5 Browser Local Surface Cleanup.** Deleted `public/sw.js` (and its
  `/sw/*` + `/tf` cache fallbacks), removed PWA `share_target` /
  `file_handlers` from `public/manifest.json` (display `standalone` ->
  `browser`), removed `#share_*` / `launchQueue` import handlers,
  `setUsingSw`, `src/preload.ts`, standalone persistence, and the local
  full/partial backup and restore-from-file paths. Deleted
  `src/ts/storage/persistant.ts`; `src/ts/storage/backup.ts` now creates
  Fastify server backups only.
- **6 Docs And Packaging Closeout.** Reworded `README.md` to a
  Fastify-served web app, aligned dev/start/Docker/smoke instructions on
  port `6002`, and updated localized local-network strings
  (`src/lang/en.ts`, `src/lang/zh-Hant.ts`) to name `/api/v1/proxy/*`.
- **7 Verification Closeout.** Ran the full ladder and a static audit
  confirming no live non-Fastify runtime entry points remain; remaining
  hits were guard tests asserting absence.

## Retained, Not Removed

The server still ships `legacyStorage.ts` and `hub.ts` routes — they
back the retained `/api/v1/storage/*` and `/api/v1/hub/*` contracts. The
"legacy" name is historical.

## Guard Tests

These assert the removed surfaces stay gone; keep them:

- `src/ts/browserLocalSurface.test.ts` — service-worker, PWA
  share/file-handler, preload, standalone persistence, local backup.
- `src/ts/globalApi.proxy.test.ts` — legacy proxy path absence.
- `server/fastify/__tests__/static.test.ts` and
  `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts` —
  `globalThis.__NODE__` absence and Fastify static serving.

## Final Verification (2026-05-27)

- `pnpm check`: 0 errors, 0 warnings.
- `pnpm test`: 76 files, 772 passed, 4 skipped.
- `pnpm api:test`: 68 files, 1217 passed.
- `pnpm build`: passed with existing nonblocking warnings.
- `pnpm smoke:fastify-browser`: 1 Playwright test passed.

## Known Minor Leftovers

- `public/functions/` is an empty directory (untracked by git).
- `src/etc/docs/docs_text.cbs` still describes "Local version (Tauri)"
  and a "Node version" as product variants; it is in-app assistant
  knowledge text, not runtime code.
