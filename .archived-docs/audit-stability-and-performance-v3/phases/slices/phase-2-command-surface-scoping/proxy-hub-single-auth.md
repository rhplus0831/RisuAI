# Slice: Proxy Hub Single Auth

Phase: [2](../../phase-2-command-surface-scoping.md). Finding: K2. Depends on
the route-level auth hooks already present on proxy/hub routes. Runtime
change.

## Scope

Remove the redundant in-handler `requireAuth` calls from proxy and hub routes
that already authenticate in `onRequest`. Protected requests should verify the
local auth assertion exactly once before body parsing or upstream forwarding.

This slice does not own proxy deadlines, hub forwarding behavior, SSRF
controls, stream-job routes, or auth policy changes.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  Known-Item Overlaps K2 / v2-L16 propagation.
- `server/fastify/src/routes/proxy.ts`: `/api/v1/proxy/fetch` `onRequest`
  auth hook and handler duplicate.
- `server/fastify/src/routes/hub.ts`: `/api/v1/hub/*` conditional
  `requiresLocalAuth(req)` hook and handler duplicate.
- Precedent:
  `.archived-docs/audit-stability-and-performance-v2/phases/slices/phase-2-server-corpus-ring-2/projection-field-scoped-loaders.md`
  removed the same double verify on bulk projection routes.
- Focused tests:
  `server/fastify/__tests__/proxy.test.ts`,
  `server/fastify/__tests__/hub.test.ts`,
  `server/fastify/__tests__/routeProtection.test.ts`,
  `server/fastify/__tests__/auth.test.ts`.

## Target Shape

- In `routes/proxy.ts`, keep the `onRequest` `requireAuth` and remove the
  handler-level `if (!(await requireAuth(...))) return`.
- In `routes/hub.ts`, keep the conditional `onRequest` auth gate and remove
  the duplicate conditional handler check.
- Ensure hub methods that do not require local auth remain public exactly as
  before, while mutating or override-bearing requests are still gated once.
- Preserve raw-body-before-parser protection: unauthenticated protected proxy
  and hub requests must still return 401 before parsing large buffered bodies.
- Add an auth-count assertion, or equivalent spy/harness, that proves an
  authenticated protected request verifies exactly once.

## Invariants

- 401/403 status codes and response bodies remain unchanged for unauthenticated
  protected requests.
- No upstream request is made when auth fails.
- Public hub GET behavior remains public unless `requiresLocalAuth(req)` says
  otherwise.
- Rate limits, request body limits, header filtering, timeout behavior, and
  abort behavior do not change.

## Done Criteria

- Proxy `/api/v1/proxy/fetch` authenticates exactly once for an authenticated
  request and still rejects unauthenticated requests.
- Hub `/api/v1/hub/*` authenticates exactly once when local auth is required,
  zero times when it is not required, and still blocks unauthorized upstream
  URL overrides.
- Route-protection tests still prove raw buffered proxy/hub bodies are
  authenticated before body parsing.
- K2 is registered as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` and flipped in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in
  the implementation change.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/proxy.test.ts \
  server/fastify/__tests__/hub.test.ts \
  server/fastify/__tests__/routeProtection.test.ts \
  server/fastify/__tests__/auth.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
