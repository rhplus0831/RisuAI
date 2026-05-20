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
- Phase 3D-Narrow landed on 2026-05-21. The Fastify
  static-serving path injects `globalThis.__FASTIFY__ = true`,
  and the SPA URL builders for proxy / stream-jobs / hub now
  prefer the new `/api/v1/*` endpoints when served by Fastify.
  Express-served (legacy) and Tauri / web modes are unchanged.
  NodeStorage and the other `isNodeServer`-gated paths still
  target Express; that migration is part of Phase 3D-Broad.
- The Docker image and compose file now run Fastify on port 6002
  with `/app/data` persisted. `server/node/server.cjs` (Express)
  still remains for `pnpm runserver`, the legacy `/api/read|write|list`
  storage endpoints, and the proxy / hub surfaces that Phase 3
  ports next. `server/hono/` is a small static-serving Hono scaffold
  and is not the Fastify migration path.
- Root `package.json` has `api:dev`, `api:start`, and `api:test`
  for the Fastify server, while `runserver` still starts Express.
- The `move-to-fastify` branch contains an agent-driven prototype
  that implements Phases 1-6; it is reference material, not the
  plan.

## Active phase

**Phase 3 - Proxy migration**, in progress.

See [`phases/phase-3-proxy.md`](phases/phase-3-proxy.md)
for the proxy / hub scope and exit criteria. Phase 3A
(`POST /api/v1/proxy/fetch`), Phase 3B (proxy stream-jobs
HTTP+WS), and Phase 3C (hub passthrough) all landed
2026-05-20; Phase 3D-Narrow (client URL switchover via the
`__FASTIFY__` flag) landed 2026-05-21. Phase 3D-Broad
(NodeStorage migration / Fastify-aware auth + save) and
Express deletion are the remaining slices.

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
