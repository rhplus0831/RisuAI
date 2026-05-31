# Phase 3: Route And Protocol Coverage Manifest

Back to original plan:
[`server-client-protocol-stability-performance.md`](../server-client-protocol-stability-performance.md#phase-3-route-and-protocol-coverage-manifest)

Status: completed on 2026-05-31.

Goal: reduce drift between route registration, active-writer classification,
route-protection tests, and architecture audit rules.

## Implementation Slices

### 3.1 Manifest Shape

- Introduce a table-driven route/protocol manifest for Fastify route metadata.
- Include method, path, auth decision, active-writer decision, streaming shape,
  and notes for intentional public exceptions.
- Start by mirroring current behavior exactly.
- Do not change route semantics in the same patch.

Done when the manifest is a faithful inventory of current route ownership and
protection decisions.

Completed with `server/fastify/src/routeManifest.ts`, which records route
method/path matching, auth decisions, active-writer decisions, streaming shape,
and documented public or conditional exceptions.

### 3.2 Active-Writer Coverage

- Use the manifest to drive or verify active-writer classification in
  `server/fastify/src/activeWriter.ts`.
- Ensure new mutating routes need an explicit writer decision.
- Preserve existing active-writer behavior while changing the source of truth.

Done when active-writer drift is caught by tests or generated expectations.

Completed by driving `server/fastify/src/activeWriter.ts` from the shared route
manifest through `routeRequiresActiveWriter()`.

### 3.3 Route Protection Coverage

- Use the manifest to drive or verify route protection expectations.
- Include explicit auth decisions for public exceptions.
- Keep Fastify route auth explicit with `requireAuth()` decisions.

Done when adding a route without an auth decision fails a test or audit.

Completed in `server/fastify/__tests__/routeProtection.test.ts`, which derives
the live Fastify route table and requires every `/api/v1/*` route to have a
manifest decision before checking auth behavior.

### 3.4 Architecture Audit Coverage

- Use the manifest to drive or verify `MUTATING_ROUTE_RULES` or its successor
  in `util/client-thinning-audit.ts`.
- Keep the audit aligned with the same route ownership inventory reviewers use.

Done when the architecture audit no longer requires a separate conceptual copy
of the mutating route list.

Completed by replacing the audit's local mutating-route rule table with
manifest lookups in `util/client-thinning-audit.ts`.

### 3.5 Special Cases

- Preserve `/api/v1/events` as authenticated streaming but not writer-gated.
- Preserve durable generation reattach as read-only observe.
- Preserve durable generation cancel as writer-gated.
- Preserve public asset reads/existence as intentional public exceptions.

Done when special cases are documented in the manifest and covered by tests.

Completed for authenticated `/api/v1/events`, durable generation reattach and
cancel, runtime proxy/generation routes, and public content-addressed asset
reads/existence probes.

## Acceptance

- Adding a new mutating route without an auth/writer decision fails a test or
  audit.
- Existing active-writer tests remain green.
- The manifest becomes the single place a reviewer checks route ownership.

## Validation

- `pnpm client-thinning:audit`
- `pnpm api:test -- server/fastify/__tests__/activeWriter.test.ts server/fastify/__tests__/routeProtection.test.ts`
