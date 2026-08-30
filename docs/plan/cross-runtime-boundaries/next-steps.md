# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [operation catalog foundation
slice](phases/slices/phase-2-route-operation-and-policy-catalog/operation-catalog-foundation.md).

1. Publish closed, browser-safe transport metadata taxonomies and stable route
   operation identifiers from an explicit protocol subpath.
2. Record one reviewed descriptor per registered API method/path template with
   stream class, cache behavior, durability tag, and response class.
3. Bind Fastify's server-owned auth and active-writer policy entries to shared
   operation identifiers without moving policy authority.
4. Make live `app.printRoutes()` coverage bidirectional and reject missing,
   stale, duplicate, or ambiguous catalog/manifest coverage.
5. Preserve every route, method, path, response, cache header, stream, policy,
   rate limit, and handler decision; run the complete Phase 2 foundation gates.

## Boundary Conventions Released

- Serialized contracts live in browser-safe `@risuai/protocol` subpaths.
- Framework-neutral behavior belongs in a separately audited shared runtime
  owner, not in the protocol package.
- Security, active-writer policy, persistence, credentials, host behavior, and
  database repair remain Fastify-owned.
- Shared historical fixtures are test-owned and cannot make browser application
  modules a server dependency.

These conventions and every inventoried Phase 1 wire contract were released at
`33d1643ae`.

## Not In This Slice

- Do not derive the browser durable-command allowlist until exact server/live
  route parity is established.
- Do not move authentication, active-writer, credential, rate-limit, host,
  persistence, cache storage, or handler-validation policy into protocol.
- Do not reconcile resource-surface or raw-generation caller metadata yet.
- Do not rename routes or runtime generation UUIDs while introducing stable
  catalog identifiers.

## Handoff

After the foundation passes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then derive the durable
browser operation allowlist by catalog identifier while preserving adversarial
near-miss coverage.
