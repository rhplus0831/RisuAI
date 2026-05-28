# Server Projection

Date: 2026-05-29

Read this when changing bootstrap, projection refresh, the projection guard, or
browser/server state ownership. This area is largely closed; the open item is the
deferred event-patching contract.

## Implemented (closed)

- Fastify injects `globalThis.__FASTIFY__ = true` when serving the SPA.
- `/api/v1/bootstrap` returns revision, schema version, masked database
  projection, and asset base URL. Writer bootstrap registers active-writer
  ownership; read-only bootstrap skips that header.
- Browser command helpers cache the latest revision from bootstrap and command
  responses.
- Projection application uses trusted write scopes; the projection write guard
  freezes ordinary `DBState.db` mutation in Fastify mode.
- `/api/v1/events` streams command and memory events.

## Bounded / Deferred

- Command events are **invalidation** signals; the browser schedules a debounced
  read-only projection refresh rather than applying surgical patches.
- **Surgical event patching is deferred** until a separate event contract exists.
  Its precondition is closing the SSE reconnect/replay gap: today a stream error
  only logs (no reconnect, no `Last-Event-ID` replay), so an accumulative patch
  applier would drift permanently on the first blip. Do not ship a surgical
  applier before that gap is closed. See
  [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md).
- Some historical local-mode normalization still lives near projection code in
  `database.svelte.ts`; proximity is not permission to mutate projected state.

## Active Direction

- Passive refresh stays read-only.
- New durable browser writes become commands or explicit server-owned routes.
- A projection guard catch is a lead: classify as command-needed, browser-local,
  trusted projection write, or legacy/no-port.

## Proof Leads

- `server/fastify/__tests__/bootstrap.test.ts`, `src/ts/server/bootstrap.test.ts`,
  `src/ts/bootstrap.test.ts`
- `server/fastify/__tests__/events.test.ts`, `src/ts/server/events.test.ts`
- `src/ts/**/*.projectionGuard.test.ts`
- `pnpm client-thinning:audit`
