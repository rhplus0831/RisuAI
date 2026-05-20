# Migration Status

Date: 2026-05-20

This is the status router. Concrete inventories live in the shards
under [`status/`](status/).

## Current snapshot

- Phase 0 removals closed on 2026-05-20. Group chat, peer
  multi-user chat, Risu Account Sync, Google Drive sync, and the
  Supa / Hypa V2 / Hanurai memory engines are removed from the live
  client/server surface.
- Phase 1 Fastify foundation closed on 2026-05-20. `server/fastify/`
  now has health and auth routes, config loading, a `node:sqlite`
  metadata table, and a vitest smoke harness.
- `server/node/server.cjs` (Express) is still the production server
  until Phase 3 retires it. `server/hono/` is a small static-serving
  Hono scaffold and is not the Fastify migration path.
- Root `package.json` has `api:dev`, `api:start`, and `api:test`
  for the Fastify server, while `runserver` still starts Express.
- The `move-to-fastify` branch contains an agent-driven prototype
  that implements Phases 1-6; it is reference material, not the
  plan.

## Active phase

**Phase 2 - Storage, import, export, assets**, not started.

See [`phases/phase-2-storage.md`](phases/phase-2-storage.md)
for the storage scope and exit criteria.

Phase 4 (`sendChat` characterization tests) can start in parallel
with Phase 2.

## Start here

- [Overview](status/overview.md) - where each workstream stands.
- [Next steps](status/next-steps.md) - the immediate slice to pick
  up.
- [Removals status](status/removals.md) - per-feature removal
  progress.
- [Server status](status/server.md) - Fastify server state.
- [sendChat status](status/sendchat.md) - stabilization progress.

## Detail shards

| Read when changing...                                                                         | Open                                         |
| --------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Anything about Group chat, peer chat, Risu Account Sync, Drive sync, or legacy memory engines | [status/removals.md](status/removals.md)     |
| The Fastify server's scope, routes, or persistence                                            | [status/server.md](status/server.md)         |
| `src/ts/process/index.svelte.ts` or its tests                                                 | [status/sendchat.md](status/sendchat.md)     |
| The overall position in the phase order                                                       | [status/overview.md](status/overview.md)     |
| What an agent should pick up next                                                             | [status/next-steps.md](status/next-steps.md) |

## Maintenance rules

- Keep one canonical home for each detailed claim; this router only
  summarizes and links.
- Update the relevant shard _and_ the date on the changed file when
  a slice lands.
- The phase docs under [`phases/`](phases/) are the long-lived plan
  and only change when scope changes. Status shards under
  `status/` are the changing surface.
