# Slice: Immutable Chunk Caching

Phase: [4](../../phase-4-server-lifecycle-and-transport.md). Finding: L20.
HTTP cache-header performance change.

## Scope

Serve content-hashed SPA chunk assets with long-lived immutable cache headers
while keeping `index.html` uncached through its existing dedicated handlers.

This slice owns static cache headers only. It does not change response
compression, static file contents, API asset routes, SPA fallback behavior, or
Vite build output.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L20.
- `server/fastify/src/app.ts`: `fastifyStatic` registration for
  `config.staticRoot`.
- `server/fastify/src/routes/assets.ts`: `IMMUTABLE_CACHE` precedent for
  content-addressed asset route headers.
- `server/fastify/__tests__/static.test.ts`: staticRoot harness and SPA
  fallback assertions.
- `docs/plan/active-risk-analysis.md` and
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` for L20 proof
  registration.

## Target Shape

- Add immutable long-cache headers to static chunk files served from the
  production static root. Acceptable shapes:
  `maxAge: '1y', immutable: true` on `fastifyStatic`, or a `setHeaders`
  callback that applies equivalent `Cache-Control` to `/assets/*`.
- Keep `index.html` outside that long-cache policy. It is served by the
  explicit `/` route and SPA fallback handler with `index: false`; add tests
  to prove those HTML responses are not immutable-cached.
- If `fastifyStatic` applies headers wider than `/assets/*`, verify that only
  content-hashed/static assets receive immutable caching, or choose
  `setHeaders` for tighter scope.
- Preserve the existing API 404 and non-GET fallback behavior.
- Register L20 as `DONE` in the v3 gate and flip only the L20 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- `/` and SPA fallback HTML must not be served with `immutable` or a one-year
  max-age.
- Static chunk/cacheable asset bodies are unchanged.
- Unknown `/api/*` routes still return API 404, not `index.html`.
- Non-GET SPA paths still do not fall back to `index.html`.
- API asset route caching remains governed by `routes/assets.ts`.

## Done Criteria

- A static chunk under `/assets/` returns `Cache-Control` with a long max-age
  and `immutable`.
- `GET /` returns HTML without immutable long-cache headers.
- SPA fallback HTML returns without immutable long-cache headers.
- Static serving behavior and fallback tests remain green.
- L20 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/static.test.ts
pnpm api:test
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
