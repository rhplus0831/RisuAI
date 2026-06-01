# Phase 7: Route Operations Coverage

Status: partly implemented; route-manifest wildcard coverage and read-only
writer-header hygiene are in place.

Goal: add route-level operational safeguards without breaking long-lived
protocol streams, and close route coverage gaps found by the audit.

## Source Anchors

- [`../../AUDIT.md`](../../AUDIT.md)
- `server/fastify/src/app.ts`
- `server/fastify/src/routeManifest.ts`
- `server/fastify/src/activeWriter.ts`
- `server/fastify/__tests__/routeProtection.test.ts`
- `util/client-thinning-audit.ts`

## Slices

- [`explicit-route-rate-limits.md`](slices/phase-7-route-operations-coverage/explicit-route-rate-limits.md)
- [`head-route-and-body-parser-audit.md`](slices/phase-7-route-operations-coverage/head-route-and-body-parser-audit.md)
- [`schema-hot-envelope-validation.md`](slices/phase-7-route-operations-coverage/schema-hot-envelope-validation.md)
- [`route-manifest-wildcard-coverage.md`](slices/phase-7-route-operations-coverage/route-manifest-wildcard-coverage.md) -
  implemented
- [`read-only-writer-header-hygiene.md`](slices/phase-7-route-operations-coverage/read-only-writer-header-hygiene.md) -
  implemented

## Exit Criteria

- Abuse-prone buffered routes have explicit, tested limits.
- SSE, WebSocket, and long-lived generation attach routes are intentionally
  excluded from ordinary request-rate limits.
- HEAD and body parser behavior does not accidentally perform full work or
  buffer before intended auth decisions.
- Wildcard routes remain visible to manifest coverage.

## Validation

- `pnpm api:test -- server/fastify/__tests__/routeProtection.test.ts`
- `pnpm client-thinning:audit`
- `pnpm api:test`
