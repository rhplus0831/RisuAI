# Route Manifest Wildcard Coverage

Status: planned.

## Source Anchors

- `server/fastify/src/routeManifest.ts`
- `server/fastify/__tests__/routeProtection.test.ts`
- `util/client-thinning-audit.ts`
- `server/fastify/src/routes/hub.ts`

## Scope

Ensure wildcard routes and Fastify route-printing edge cases remain visible to
manifest coverage and architecture audit rules.

## Protocol Behavior

- Keep `/api/v1/*` coverage explicit even when Fastify reports wildcard routes
  in unusual forms.
- Preserve intentional public exceptions and streaming classifications.
- Keep route manifest matching cost small compared with request handlers.

## Done When

- Wildcard and generated route shapes cannot hide from route-protection tests.
- The audit uses the same manifest decisions reviewers inspect.
- New routes without decisions fail fast.

## Validation

- `pnpm api:test -- server/fastify/__tests__/routeProtection.test.ts`
- `pnpm client-thinning:audit`
