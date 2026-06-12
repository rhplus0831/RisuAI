# Route Manifest Coverage

Status: implemented foundation.

## Source Anchors

- `server/fastify/src/routeManifest.ts`
- `server/fastify/src/activeWriter.ts`
- `server/fastify/__tests__/routeProtection.test.ts`
- `util/client-thinning-audit.ts`

## Scope

Keep the route manifest as the single inventory for auth decisions,
active-writer ownership, streaming shape, and public exceptions.

## Done When

- New `/api/v1/*` routes require a manifest decision.
- Active-writer classification reads from the manifest.
- Route protection tests and the architecture audit fail on drift.
- Streaming, reattach, cancel, and public asset exceptions remain documented.

## Validation

- `pnpm api:test -- server/fastify/__tests__/activeWriter.test.ts server/fastify/__tests__/routeProtection.test.ts`
- `pnpm client-thinning:audit`
