# Command Boundaries

Date: 2026-05-28

Read this when changing command routes, browser command helpers, revision
handling, active writer, or command events.

## Implemented

- Public command routes live under `/api/v1/commands/*`.
- Browser helpers live in `src/ts/server/commands.ts` plus narrower helpers in
  domain files.
- Command bodies carry `baseRevision`.
- Stale revisions return 409 with the current revision.
- Successful JSON command mutations bump revision once and emit one command
  event.
- Active-writer protection rejects stale mutating sessions with 423.
- Command resource helpers cover the major durable resource families.

## Bounded Or Partial

- `routes/commands.ts` is large. Resource-specific helpers reduce risk, but
  route-level additions still need careful auth, active-writer, and revision
  checks.
- Composite browser fan-out must either use a sequencer or become a single
  server command.
- Repair-on-read id minting is only acceptable where documented and not derived
  from request payloads.

## Active Direction

- New command routes must validate stable ids and avoid index-addressed public
  contracts.
- Do not blindly retry conflicts. Surface conflict or let the central command
  wrapper update revision state.
- New mutable routes outside `/api/v1/commands/*` must be classified under the
  active-writer guard or explicitly documented as non-durable/stateless.

## Proof Leads

- `server/fastify/__tests__/commands.test.ts`
- `src/ts/server/commands.test.ts`
- `server/fastify/__tests__/activeWriter.test.ts`
- `pnpm client-thinning:audit`
