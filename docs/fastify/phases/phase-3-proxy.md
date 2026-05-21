# Phase 3 - Proxy Migration

Date: 2026-05-21

Status: **closed 2026-05-21.** Fastify owns the proxy fetch, hub
passthrough, stream-job HTTP+WS, legacy key-value storage, auth,
crypto, and SPA static surface (with `__NODE__` + `__FASTIFY__`
injection). The Express server has been deleted; the `runserver`
script and the `express` / `express-rate-limit` /
`node-html-parser` dependencies are gone. The hub-route /
`requireAuth` decision (element-loaded resources 401 on
password-protected deployments) is the one accepted follow-up
tracked in [`../status/next-steps.md`](../status/next-steps.md).
The rest of this document is the plan-of-record as it stood
during the migration.

## Goal

Move outbound HTTP for generation and the Risuai hub passthrough
behind Fastify, with the same security rules the Express server
enforced before deletion. Retire the Express server once parity is
proven.

## Preconditions

- Phase 2 closed (Fastify can serve the SPA and owns the data dir
  before Express is retired).

## Scope

### Routes

- `POST /api/v1/proxy/fetch` - generic upstream fetch. Accepts
  `risu-url`, `risu-header`, and `risu-timeout-ms` headers; the
  Fastify route is POST-only and forwards upstream as POST. It
  streams the upstream response body back to the client, including
  SSE bodies, without route-level buffering.
- `POST /api/v1/proxy/stream-jobs` - opens a stream job; returns a
  `jobId` and `heartbeatSec`. The job runs in-process; the client
  attaches via WebSocket.
- `GET /api/v1/proxy/stream-jobs/:id/ws` - WebSocket upgrade.
  Sends `job_accepted`, `upstream_headers`, repeated `chunk`,
  terminal `done` / `error`, plus heartbeats.
- `DELETE /api/v1/proxy/stream-jobs/:id` - cancels the job.
- `ANY /api/v1/hub/*` - passes the request through to
  `RISU_HUB_URL` (default `https://sv.risuai.xyz`). Honors the
  `x-risu-node-path` override header so the hub can route through
  custom node paths.

### Security rules (ported from the Express server)

- `sanitizeLocalTargetUrl` accepts only `http(s)` URLs that target
  local / private network hosts for the stream-job endpoints.
- Strip `host`, `connection`, `content-length`, `risu-auth`,
  `risu-timeout-ms`, `risu-url`, `risu-header` from forwarded
  headers.
- Strip `content-security-policy`,
  `content-security-policy-report-only`, `clear-site-data`,
  `Cache-Control`, `Content-Encoding` from upstream response
  headers before forwarding.
- If a forwarded header set does not already include
  `x-forwarded-for`, set it to `req.ip`; `TRUST_PROXY` controls how
  Fastify derives `req.ip`.
- Hub `Authorization: X-Node-Server-Auth` requests refresh the
  Sionyw access token. Phase 0 removes this entirely; do not port
  it.
- Stream-job limits: max 64 active jobs, max 512 pending events,
  max 2 MiB pending bytes, max 8 MiB request body base64, default
  10-minute timeout, 1-hour absolute cap.

### Auth

- All authenticated proxy and hub routes use the standard Fastify
  `requireAuth` guard, which accepts a valid ES256 assertion via
  the `risu-auth` header. The password is only used during initial
  setup (`POST /api/v1/auth/login`) to register a client public
  key; it is not accepted as a header on later requests. Do not
  port the Express `isAuthorizedRequest` / `checkProxyAuth`
  password-header path.
- WebSocket upgrade accepts the ES256 assertion as a `risu-auth`
  query-string parameter so EventSource-style clients (which
  cannot set custom headers) can still attach.
- Hub `/api/v1/hub/*` uses the same `requireAuth` guard before
  forwarding. The old `X-Node-Server-Auth` Sionyw token injection
  path was removed in Phase 0 and must not be ported.

### Retirement of Express

After parity is proven on the proxy + hub routes:

- Fastify keeps the Phase 2 production-build SPA serving and Docker
  runtime.
- `runserver` script removed from `package.json`.
- `server/node/` deleted in a single commit; reference the commit
  in [`../status/server.md`](../status/server.md).

## Boundaries

- **Do not port the Sionyw OAuth flow.** Phase 0 removed it.
- **Do not redesign the proxy contract.** Existing clients send
  `risu-url` / `risu-header` / `risu-timeout-ms`; new routes
  accept exactly those headers. Redesign is Phase 9 work.
- **Do not introduce new outbound capabilities.** Hub passthrough
  and provider proxy only. Server-side generation routes land in
  Phase 6.

## Exit criteria

- `pnpm api:test` covers:
  - URL sanitization (blocked schemes, blocked external hosts on
    stream-jobs, IPv6 bracket handling, mapped-IPv4 cases).
  - Header sanitization in both directions.
  - SSE forwarding without buffering.
  - Timeout handling. Direct `/proxy/fetch` client-disconnect abort
    wiring is not separately implemented; stream jobs abort via
    delete, timeout, and GC.
  - Stream-job lifecycle: open, attach WebSocket, receive frames,
    delete mid-stream.
  - Hub passthrough including the `x-risu-node-path` override.
- The browser's proxy URL builders route through
  `/api/v1/proxy/fetch` and `/api/v1/proxy/stream-jobs` when
  `platform.isFastifyServer` is true.
- The Express server is deleted; `pnpm runserver` is gone.
- `pnpm check`, `pnpm test`, `pnpm build`, `pnpm api:test` green.

## Reference

- Historical Express proxy reference before deletion:
  `2c234d9^:server/node/server.cjs` around lines 744-1122. The
  Fastify port is a clean rewrite, not a copy.
- `move-to-fastify` proxy slice: `a1711803`, `fcfd69a8`,
  `58cfea1a`, `c929ca87`. The `PROVIDER_FETCH_AUDIT.md` on that
  branch lists every call site that currently bypasses the
  proxy; same list applies here.
