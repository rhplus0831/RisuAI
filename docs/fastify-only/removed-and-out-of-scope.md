# Removed And Out Of Scope

## Removed In Phase 1

- Hono server, including Node, Bun, Cloudflare, Vercel, and Wrangler entry points.
- Electron package scripts and stale native desktop launch scripts.
- Capacitor mobile packaging configuration.
- Legacy `server.sh` and `server.bat` launchers.
- Hono static/Vercel postbuild output flows.

## Removed In Phase 3

- Legacy client storage route selection for `/api/write`, `/api/read`, `/api/list`, and `/api/remove`.
- OPFS and localforage app-runtime persistence selection through `AutoStorage`.
- Standalone browser save-file bootstrap as a supported app startup path.
- Startup-time service worker registration from the removed local save-file bootstrap path.

## Removed In Phase 4

- Legacy client proxy route selection for `/proxy2` and `/proxy-stream-jobs`.
- Cloudflare Pages-style hosted proxy functions in `public/functions/proxy.js` and `public/functions/proxy2.js`.

## Removed In Phase 5

- Service worker artifact `public/sw.js`, including `/sw/check`, `/sw/register`, `/sw/img`, `/sw/share`, and `/tf` cache fallbacks.
- PWA `share_target` and `file_handlers` entries from `public/manifest.json`.
- Client `#share_*` and `launchQueue` file import handlers that depended on service-worker share cache.
- Service-worker image cache selection through `setUsingSw`.
- Startup preload marker in `src/preload.ts`.
- Standalone/PWA storage persistence from client bootstrap and `src/ts/platform.ts`.
- Local full backup, local partial backup, local backup-file restore, and local internal-backup fallback paths.
- `src/ts/storage/persistant.ts`.

## Remaining Removal Targets

- Public README language that presents non-Fastify platforms as supported runtimes.
- User-facing app strings that mention removed runtimes, flags, or endpoints.

## Preserved Surfaces

- Fastify API routes under `/api/v1/*`.
- Fastify static serving of the built web client.
- Docker and compose flows that run `pnpm api:start`.
- Vite development proxying when it targets the Fastify API server.
- Test fixtures that validate generation behavior independent of removed platform adapters.

## Permanent Non-Goals

- Do not keep Hono or other platform files as examples.
- Do not keep package scripts that point at removed platforms.
- Do not keep compatibility redirects for legacy local or hosted endpoints.
- Do not document removed platforms as unofficial alternatives.
- Do not keep localized runtime guidance that points users at removed modes.

## References

- `package.json:9`
- `docs/fastify-only/phases-completed/phase-1-project-surface-removal-2026-05-27.md:1`
- `docs/fastify-only/phases-completed/phase-4-proxy-and-api-routing-2026-05-27.md:1`
- `docs/fastify-only/phases-completed/phase-5-browser-local-surface-cleanup-2026-05-27.md:1`
