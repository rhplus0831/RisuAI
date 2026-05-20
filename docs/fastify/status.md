# Migration Status

Date: 2026-05-21

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
- Phase 2 server storage closed on 2026-05-20. Fastify now has
  bootstrap, JSON import, raw asset upload / read / head / exists
  checks, backup create / list / restore / delete, optional static
  SPA serving, and route tests for those surfaces.
- Phase 4 sendChat characterization tests closed on 2026-05-20.
  All 17 fixtures land under `src/ts/process/__fixtures__/` with
  per-fixture DB / upstream / expected files plus targeted
  `vi.mock`s for the heavy side-effect modules. Phase 5 can now
  refactor sendChat behind a real safety net.
- Phase 3A, Phase 3B, and Phase 3C all landed on 2026-05-20.
  `POST /api/v1/proxy/fetch` is in place behind `requireAuth`,
  the proxy stream-job surface (`POST` / `DELETE` plus the
  WebSocket upgrade at `GET /api/v1/proxy/stream-jobs/:id/ws`)
  is live on top of an in-memory `JobRegistry`, and the hub
  passthrough is now `ANY /api/v1/hub/*` reading
  `config.hubUrl` (`RISU_HUB_URL` env, default
  `https://sv.risuai.xyz`).
- Phase 3D-Narrow and Phase 3D-Broad both landed on 2026-05-21.
  The Fastify static-serving path injects
  `globalThis.__NODE__ = true; globalThis.__FASTIFY__ = true;`,
  the SPA URL builders prefer `/api/v1/*` endpoints, and a
  Fastify-served SPA can sign in, persist the database, and use
  cold storage end-to-end (Fastify gained
  `/api/v1/storage/{list,read,write,remove}` and
  `/api/v1/auth/crypto` as the legacy key-value surface
  `NodeStorage` targets).
- Phase 3 closed on 2026-05-21 with the Express deletion. The
  `server/node/` directory, the `runserver` script, and the
  `express` / `express-rate-limit` / `node-html-parser`
  dependencies were removed.
- The Docker image and compose file run Fastify on port 6002
  with `/app/data` persisted. `server/node/` (Express) has been
  deleted; `server/hono/` is a small static-serving Hono
  scaffold and is not the Fastify migration path.
- Root `package.json` has `api:dev`, `api:start`, and
  `api:test` for the Fastify server. The `runserver` script
  has been removed.
- The `move-to-fastify` branch contains an agent-driven prototype
  that implements Phases 1-6; it is reference material, not the
  plan.

## Active phase

**Phase 3 - Proxy migration**, closed 2026-05-21. Fastify owns
the proxy / hub / stream-job / storage / auth / crypto surface
and Express is deleted.

Phase 5 (`sendChat` extraction) is the natural next pickup
behind the characterization-test safety net landed in Phase 4.
Phase 6 (server-side LLM / translation / TTS / image
generation) is the other major server-side workstream open for
new work.

Phase 4 (`sendChat` characterization tests) closed 2026-05-20.
The harness lives at `src/ts/process/__fixtures__/` and
`src/ts/process/__tests__/sendChat.fixtures.test.ts`; all 17
target fixtures pin. Phase 5 (`sendChat` extraction) can now
start in parallel with Phase 3.

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
