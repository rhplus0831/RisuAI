# HEAD Route And Body Parser Audit

Status: planned.

## Source Anchors

- `server/fastify/src/app.ts`
- `server/fastify/src/routes/assets.ts`
- `server/fastify/src/routes/proxy.ts`
- `server/fastify/src/routes/hub.ts`
- `server/fastify/src/routes/projection.ts`
- `server/fastify/src/routes/save.ts`

## Scope

Review implicit `HEAD` behavior and buffered body parser ordering so cheap or
unauthenticated requests do not accidentally perform full work.

## Protocol Behavior

- Keep explicit cheap `HEAD` behavior for public immutable asset reads.
- Confirm projection, bootstrap, export, and streaming routes do not do
  expensive work for accidental `HEAD` requests.
- Review raw asset and multipart buffering before handler-level auth/writer
  checks.

## Done When

- Accidental `HEAD` requests are cheap, rejected, or intentionally documented.
- Large body routes have clear auth and size-limit ordering.
- Tests cover any route behavior changes.

## Validation

- `pnpm api:test`
- Focused route tests for changed `HEAD` or parser behavior.
