# Operation Catalog Foundation

Status: ready.

Parent: [Phase 2](../../phase-2-route-operation-and-policy-catalog.md)

Depends on: Phase 1 protocol conventions at
`33d1643aedcf74aecf3f0d8b549b0313a061c6b1`.

## Objective

Give every registered API method/path template a stable browser-safe operation
identifier and reviewed transport metadata, then prove exact parity with live
Fastify registration and server-owned route policy.

## Catalog Contract

- Publish HTTP method, path-match, stream-class, cache-behavior,
  durability-tag, and response-class taxonomies from an explicit
  `@risuai/protocol` subpath.
- Record full `/api/v1/...` path templates. Runtime generation UUIDs remain
  request identities and are not catalog operation identifiers.
- Keep transport metadata descriptive. It cannot grant authentication,
  active-writer, credential, rate-limit, host, persistence, or handler authority.
- Preserve exact route IDs where they already exist; any finer-grained command
  IDs must be stable and independently reviewed.

## Parity Contract

- Parse `app.printRoutes({ commonPrefix: false })` and require every live API
  method/path to have exactly one catalog descriptor and one server policy
  decision.
- Reject stale descriptors, stale policy entries, duplicate IDs, duplicate
  method/path keys, and ambiguous policy matches.
- Keep intentional public, conditional-auth, read-only POST, runtime proxy,
  runtime generation, observer stream, and compatibility exceptions explicit.

## Validation

Protocol catalog fixtures and import audit, Fastify route-protection and
manifest parity tests, `pnpm check:protocol`, `pnpm check:server`, `pnpm check`,
affected tests, browser smoke if registration code changes, formatting, exact
inventory comparison, and `git diff --check`.

## Done When

- One reviewed catalog owns stable IDs and non-authoritative transport metadata
  for every live API operation.
- Live registration and server policy coverage are bidirectional, unique, and
  fail closed.
- No route, method, path, response, cache header, stream, policy, rate limit, or
  handler behavior changes.

Stop if catalog adoption requires browser metadata to authorize a request or if
one descriptor would hide materially different operation behavior.
