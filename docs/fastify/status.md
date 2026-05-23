# Migration Status

Date: 2026-05-23

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
  The original 17 fixtures landed under
  `src/ts/process/__fixtures__/` with per-fixture DB / upstream /
  expected files plus targeted `vi.mock`s for the heavy side-effect
  modules. Phase 5 added nine narrow gate fixtures, and Phase 6
  added twelve provider parity fixtures, so the active local
  snapshot count is 38. Those twelve Phase 6 provider fixtures also
  run through
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`.
- Phase 5 sendChat extraction closed on 2026-05-22. Commits
  `3c5a92b2` through `a7e2831d` landed all 28 slices: the
  coordinator now lives in `src/ts/process/index.svelte.ts` at
  445 lines, while prompt assembly, request budgeting, dispatch,
  response orchestration, Stage 4 closeout, and entry-context setup
  live in focused helper modules. The slice history is archived in
  [`status/sendchat-slicing.md`](status/sendchat-slicing.md).
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
- Phase 6 completion routing closed on 2026-05-22 in Phase 6-28
  (`398a3ae6`; hash backfilled by `a8cb123b`). The auth-gated
  `POST /api/v1/generate/completion` route implements the
  normalized SSE envelope, provider dispatch, native Ollama,
  Vertex AI Gemini, AWS Bedrock Claude, Stable Horde text, and
  `reverse_proxy` / `xcustom:::` overlays for the routed formats.
  The client adapter is flag-gated by `db.useServerGeneration`; the
  current matrix and remaining local-only paths are tracked in
  [`coverage/providers.md`](coverage/providers.md).
- Phase 7 prompt assembly is in progress. Twenty-nine slices have
  landed through 7-9f: the auth-gated
  `POST /api/v1/generate/chat` scaffold, the locked nine-event
  prompt SSE taxonomy, server-side `expandVariables`, static/plain
  prompt sections, history shaping through added-token/depth-prompt
  preflight + start-trigger handoff, regex scripts, active-module
  helpers, lorebook activation through budget-aware truncation, the
  minimal server tokenizer, template-wide token preflight, and request
  budget finalization, plus the trigger model, variable/condition
  engine, deterministic V1 effects, V2 control flow, V2 safe data
  helpers, the request/display state adapters, and the `runStartTrigger`
  handoff. `assemble` and `templates` remain stubs; the trigger and
  history fronts are complete, so next work is 7-10a, the template
  front.
- The Dockerfile and compose file target Fastify on port 6002
  with `/app/data` persisted. The runtime image copies production
  dependencies only, and `tsx` plus `@fastify/websocket` are now
  production dependencies, so the current TSX runtime layout is
  self-contained. `server/node/` (Express) has been deleted;
  `server/hono/` is a small static-serving Hono scaffold and is not
  the Fastify migration path.
- Root `package.json` has `api:dev`, `api:start`, and
  `api:test` for the Fastify server. The `runserver` script
  has been removed.
- The `move-to-fastify` branch contains an agent-driven prototype
  that implements Phases 1-6; it is reference material, not the
  plan.

## Current phase

Phase 7 (server-side prompt assembly) is active. It starts from
the Phase 5 prompt-assembly modules and will call the Phase 6
completion route after assembling the payload. The current
guardrails are the 38 local sendChat snapshots, the 12-fixture
server-backed sweep, and the Fastify generation provider tests.

Phase 3 closed on 2026-05-21; Fastify owns the proxy / hub /
stream-job / storage / auth / crypto surface and Express is deleted.

## Start here

- [Overview](status/overview.md) - where each workstream stands.
- [Next steps](status/next-steps.md) - the immediate slice to pick
  up.
- [Removals status](status/removals.md) - per-feature removal
  progress.
- [Server status](status/server.md) - Fastify server state.
- [sendChat status](status/sendchat.md) - stabilization progress.
- [sendChat slicing](status/sendchat-slicing.md) - historical Phase
  4 gate and Phase 5 extraction slice record.

## Detail shards

| Read when changing...                                                                         | Open                                                                                               |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Anything about Group chat, peer chat, Risu Account Sync, Drive sync, or legacy memory engines | [status/removals.md](status/removals.md)                                                           |
| The Fastify server's scope, routes, or persistence                                            | [status/server.md](status/server.md)                                                               |
| `src/ts/process/index.svelte.ts` or its tests                                                 | [status/sendchat.md](status/sendchat.md), [status/sendchat-slicing.md](status/sendchat-slicing.md) |
| The overall position in the phase order                                                       | [status/overview.md](status/overview.md)                                                           |
| What an agent should pick up next                                                             | [status/next-steps.md](status/next-steps.md)                                                       |

## Maintenance rules

- Keep one canonical home for each detailed claim; this router only
  summarizes and links.
- Update the relevant shard _and_ the date on the changed file when
  a slice lands.
- The phase docs under [`phases/`](phases/) are the long-lived plan
  and only change when scope changes. Status shards under
  `status/` are the changing surface.
