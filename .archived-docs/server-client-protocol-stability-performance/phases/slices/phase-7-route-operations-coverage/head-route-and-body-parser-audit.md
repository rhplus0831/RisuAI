# HEAD Route And Body Parser Audit

Status: implemented.

## Source Anchors

- `server/fastify/src/app.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/routes/proxy.ts`
- `server/fastify/src/routes/hub.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/routes/save.ts`
- `server/fastify/src/routes/bootstrap.ts`
- `server/fastify/src/routes/events.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/activeWriter.ts`
- `server/fastify/src/routeManifest.ts`
- `server/fastify/__tests__/assets.test.ts`
- `server/fastify/__tests__/routeProtection.test.ts`

## Scope

Review implicit `HEAD` behavior and buffered body parser ordering so cheap or
unauthenticated requests do not accidentally perform full work.

Implemented scope:

- Disabled Fastify's implicit `HEAD` handlers for authenticated expensive GETs:
  bootstrap, projection hydration, `.risu` export, bundle export, event SSE,
  and durable-generation reattach SSE.
- Kept the explicit cheap public `GET/HEAD /api/v1/assets/:id` behavior.
- Kept the hub proxy's explicit conditional `HEAD` behavior documented in the
  route manifest.
- Added pre-body `onRequest` auth gates for raw-buffered proxy and hub proxy
  POST requests.
- Added a pre-body asset upload gate that checks auth and the active-writer
  lease before the global raw asset parser buffers request bytes.

## Protocol Behavior

- Keep explicit cheap `HEAD` behavior for public immutable asset reads.
- Projection, bootstrap, export, event-stream, and durable generation reattach
  routes now return not-found for accidental `HEAD` requests instead of running
  the GET handler.
- Raw asset upload, proxy fetch, and locally-authenticated hub proxy requests
  reject unauthenticated requests before body parsing. Asset upload also rejects
  stale writer sessions before body parsing.
- Multipart `.risu` import still calls `req.file().toBuffer()` only after
  handler auth and the global active-writer preHandler run.

## Done When

- Accidental `HEAD` requests are cheap, rejected, or intentionally documented.
  Done.
- Large body routes have clear auth and size-limit ordering. Done.
- Tests cover any route behavior changes. Done.

## Validation

- `pnpm api:test __tests__/routeProtection.test.ts __tests__/assets.test.ts __tests__/risuSaveExportRoute.test.ts __tests__/risuSaveBundleExportRoute.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
