# Slice: Hub Forward Abort Timeout

Phase: [8](../../phase-8-server-bounds.md). Finding: L27. Runtime change.
Status: done on 2026-06-06 KST.

## Scope

Add upstream deadlines and abort-on-disconnect behavior to hub forwards, and
remove avoidable long-lived request body buffering from the forwarding path.

This slice does not own `/api/v1/proxy/fetch`, provider proxy routes, Realm
import download caps, or hub URL configuration.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L27.
- `server/fastify/src/routes/hub.ts`: request forwarding, redirect re-forward,
  raw body handling, header stripping, and auth decisions.
- `server/fastify/src/proxy.ts`: shared proxy header and timeout helpers if
  they can be reused.
- Existing focused suites:
  `server/fastify/__tests__/hub.test.ts`,
  `server/fastify/__tests__/routeProtection.test.ts`, and
  `server/fastify/__tests__/payloadBudgets.test.ts`.

## Target Shape

- Add a default upstream deadline for hub forwards, with a reasonable
  config/helper boundary if one already exists for proxy requests.
- Wire request-close and response-close signals to abort the upstream fetch.
- Forward request bodies without retaining extra full-body copies. Acceptable
  shapes include direct streaming where Fastify/raw-body constraints allow it,
  a bounded single buffer with no duplicate redirect replay, or explicit
  rejection of unsafe body redirects instead of pinning multiple 100 MB copies.
- Keep the existing body limit as a hard cap even if the forwarding mechanism
  changes.
- Preserve origin/header rewrite behavior, proxy-control header stripping, hub
  auth, and current GET/POST response semantics.
- Surface upstream timeout as a clear 504-style response and client disconnect
  as an abort without leaking sockets.
- Add tests for timeout, client disconnect abort, bounded body handling, and
  redirect behavior for body-bearing requests.
- Register L27 as `DONE` in the v2 gate with focused tests, and flip its row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Existing valid hub GET and POST forwards still reach the same upstream URL
  with the same allowed headers.
- Mutating hub requests remain protected when auth is configured.
- Proxy-control headers are not forwarded to the hub.
- Upstream aborts must clear timers and not leave pending fetches.

## Done Criteria

- Hung hub upstreams fail within the configured deadline.
- Closing the client connection aborts the upstream request.
- Body forwarding avoids duplicate long-lived full-body retention or rejects
  unsafe redirects explicitly.
- The L27 v2 gate entry points at real focused tests and the risk-map row is
  `DONE`.

## Proof

- Runtime:
  `server/fastify/src/routes/hub.ts` now applies the shared upstream timeout
  bound to every hub fetch, aborts upstream fetches when the request or response
  closes, keeps the parsed upload as one bounded body view, and rejects
  body-bearing redirects instead of replaying the upload.
- Regression tests:
  `server/fastify/__tests__/hub.test.ts` covers
  `L27: returns 504 when the hub upstream deadline elapses before response`,
  `L27: aborts the upstream stream when the client disconnects`,
  `L27: rejects body-bearing redirects instead of replaying the buffered upload`,
  and `L27: keeps the hub body limit as a hard cap for authenticated uploads`.
- Gate/risk proof:
  `src/ts/__tests__/fixCompletenessGateV2.test.ts` registers L27 as `DONE`
  with the focused hub tests, and
  `.archived-docs/audit-stability-and-performance-v2/active-risk-analysis.md`
  marks the L27 row `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/hub.test.ts \
  server/fastify/__tests__/routeProtection.test.ts \
  server/fastify/__tests__/payloadBudgets.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
