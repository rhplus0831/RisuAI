# Removed And Out Of Scope

## Removal Targets

- Hono server, including Node, Bun, Cloudflare, Vercel, and Wrangler entry points.
- Electron scripts and any stale native desktop assumptions.
- Capacitor mobile packaging configuration.
- Legacy `server.sh` and `server.bat` launchers.
- Cloudflare Pages-style functions in `public/functions`.
- Legacy storage paths: `/api/write`, `/api/read`, `/api/list`, and `/api/remove`.
- Legacy proxy paths: `/proxy2` and `/proxy-stream-jobs`.
- Standalone browser save-file bootstrap as a supported runtime.
- OPFS or localforage persistence when used as a replacement for server-backed Fastify storage.
- Service worker share/import behavior when it implies standalone local support.
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

- `server/hono/package.json:1`
- `package.json:9`
- `server.sh:1`
- `server.bat:1`
- `capacitor.config.ts:1`
- `public/functions/proxy.js:1`
- `public/functions/proxy2.js:1`
