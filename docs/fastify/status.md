# Migration Status

Date: 2026-05-20

This is the status router. Concrete inventories live in the shards
under [`status/`](status/).

## Current snapshot

- The roadmap is freshly written. No phase work has started on the
  `fastify` branch.
- `server/node/server.cjs` (Express) is the only running server.
  `server/hono/` is a near-empty scaffold and is not on the
  migration path.
- The `move-to-fastify` branch contains an agent-driven prototype
  that implements Phases 1-6; it is reference material, not the
  plan.

## Active phase

**Phase 0 - Removals**, not started.

See [`phases/phase-0-removals.md`](phases/phase-0-removals.md) for
scope, exit criteria, and the inventory of code to delete.

Phase 0 must close before Phase 1 starts so the Fastify foundation
is not built around code that will then be deleted.

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
