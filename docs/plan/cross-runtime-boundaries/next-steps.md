# Cross-Runtime Boundaries Next Steps

Date: 2026-08-30

## Current Best Task

Execute the [durable command operation catalog
slice](phases/slices/phase-2-route-operation-and-policy-catalog/durable-command-operation-catalog.md).

1. Give every browser-durable command pattern a stable operation identifier in
   a browser-safe protocol subpath.
2. Match queued request method/path pairs through that catalog instead of the
   private `ALLOWED_DURABLE_COMMANDS` regular-expression array.
3. Prove exact parity with the existing 129 accepted patterns, including
   adversarial near misses, and reject duplicate operation identifiers.
4. Relate generation submit, cancel, and retry intents to the stable route
   identifiers already published by the shared route operation catalog.
5. Preserve queueing, replay, retry, and rejection behavior. Record validation
   that remains deferred under the session's no-test constraint.

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

## Foundation Released

- `@risuai/protocol/route-operation` publishes 103 stable route IDs and reviewed
  transport descriptors at `00e49d880`.
- Fastify owns a separate 103-entry auth/writer policy catalog joined by ID.
- Live-route parity rejects missing, stale, duplicate, and ambiguous catalog or
  policy coverage.

## Not In This Slice

- Do not move queue storage, replay scheduling, authentication, active-writer,
  credential, rate-limit, host, persistence, cache storage, or handler policy
  into protocol.
- Do not reconcile resource-surface or raw-generation caller metadata yet.
- Do not change routes, request bodies, or runtime generation UUIDs while
  introducing stable durable-operation identifiers.

## Handoff

After this slice, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then reconcile browser
resource, cache, generation, and raw-generation metadata against the shared
operation catalog.
