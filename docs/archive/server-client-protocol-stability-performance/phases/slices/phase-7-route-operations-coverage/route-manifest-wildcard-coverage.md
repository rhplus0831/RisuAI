# Route Manifest Wildcard Coverage

Status: implemented.

## Source Anchors

- `server/fastify/src/routeManifest.ts`
- `server/fastify/__tests__/routeProtection.test.ts`
- `util/client-thinning-audit.ts`
- `server/fastify/src/routes/hub.ts`

## Scope

Ensure wildcard routes and Fastify route-printing edge cases remain visible to
manifest coverage and architecture audit rules.

Implemented behavior:

- `routeManifest.ts` supports exact, prefix, and pattern matching, including
  `*` wildcards such as `/api/v1/hub/*`.
- `routeProtection.test.ts` derives live API routes from
  `app.printRoutes({ commonPrefix: false })` and fails when a route lacks a
  manifest decision.
- `util/client-thinning-audit.ts` also reads the manifest and checks for stale
  or missing route decisions.

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
