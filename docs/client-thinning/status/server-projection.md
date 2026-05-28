# Server Projection

Date: 2026-05-28

Read this when changing bootstrap, projection refresh, projection guard, or
browser/server state ownership.

## Implemented

- Fastify injects `globalThis.__FASTIFY__ = true` when serving the SPA.
- `/api/v1/bootstrap` returns revision, schema version, masked database
  projection, and asset base URL.
- Writer bootstrap registers active-writer ownership; read-only bootstrap skips
  the active-writer header.
- Browser command helpers cache the latest revision from bootstrap and command
  responses.
- Projection application uses trusted write scopes.
- The projection write guard freezes ordinary `DBState.db` mutation in Fastify
  mode.
- `/api/v1/events` streams command and memory events.

## Bounded Or Partial

- Command events are invalidation events. The browser refreshes projection
  instead of applying surgical patches.
- Some historical local-mode normalization and compatibility code still lives
  near projection code in `database.svelte.ts`. Do not treat proximity as
  permission to mutate projected state.
- Manual legacy local verification is separate from Fastify projection
  hardening.

## Active Direction

- Passive refresh must stay read-only.
- New durable browser writes should become commands or explicit server-owned
  mutation routes.
- Projection guard failures are leads: classify as command-needed,
  browser-local, trusted projection write, or no-port.

## Proof Leads

- `server/fastify/__tests__/bootstrap.test.ts`
- `src/ts/server/bootstrap.test.ts`
- `src/ts/bootstrap.test.ts`
- `server/fastify/__tests__/events.test.ts`
- `src/ts/server/events.test.ts`
- `src/ts/**/*.projectionGuard.test.ts`
- `pnpm client-thinning:audit`
