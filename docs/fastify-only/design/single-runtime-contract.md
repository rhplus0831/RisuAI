# Single Runtime Contract

## Decision

Fastify is the only supported production runtime. The client should run as static assets served by Fastify and should not select behavior for local, native, Hono, hosted function, or legacy node server platforms.

## Rationale

The existing migration already targets server-backed web. Keeping broad platform gates after the Fastify server exists increases test cost and makes user-facing behavior harder to reason about. A single runtime contract lets storage, proxy, bootstrap, and smoke coverage align around one API surface.

## Implementation Notes

- Collapse `src/ts/platform.ts` to the smallest set of signals needed for Fastify-served runtime and test harnesses.
- Remove `globalThis.__NODE__` as a Fastify compatibility signal.
- Keep development-only distinctions local to build and test tooling instead of runtime feature branches.

## Revisit Triggers

- A new supported runtime is explicitly accepted as product scope.
- Fastify static serving is replaced by a different first-party server.
- Tests require an explicit harness signal that cannot be represented without runtime metadata.

## References

- `src/ts/platform.ts:13`
- `server/fastify/src/app.ts:176`
- `src/ts/bootstrap.ts:137`
