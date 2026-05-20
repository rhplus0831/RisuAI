# Server Status

Date: 2026-05-20

## Current state

No Fastify server exists on the `fastify` branch. The runtime
servers in tree are:

- `server/node/server.cjs` - Express server used today. Owns the
  static SPA, password + ES256 auth, proxy / proxy2 fetch, hub
  passthrough, save file CRUD, Sionyw OAuth login flow.
- `server/hono/` - 12-line Hono scaffold (`Hello Hono!`). Not on
  the migration path.

`pnpm api:dev` does not yet exist. `pnpm runserver` runs the Node
server.

## What lands when

- **Phase 1.** `server/fastify/` directory, `pnpm api:dev` /
  `pnpm api:start` / `pnpm api:test`, health endpoint, env loader,
  auth scaffold, db connection. Vite proxy `/api` -> Fastify.
- **Phase 2.** SQLite schema + repository + migrations, asset
  storage, Risu save import/export, backups.
- **Phase 3.** Provider proxy + hub passthrough + stream-job
  WebSocket. Express server is retired once Phase 3 closes.
- **Phase 6.** Server-side LLM / translation / TTS / image /
  Stable Horde generation endpoints.
- **Phase 7.** Server-side prompt assembly + lorebook activation.
- **Phase 8.** Hypa V3 chunking + embeddings + summary jobs.

## Reference: what move-to-fastify shipped

For each phase, the `move-to-fastify` branch already has a worked
example. The links below are commit prefixes; resolve them on that
branch.

- Phase 1 foundation: `0c3de7de`, `d430d31c`, `e10499a2`.
- Phase 2 storage: `ae2252e5`, `f04c3e04`, `a1836719`,
  `2d786cb6`, `ba5e1c82`, `3d3e217e`, `511eecec`,
  `19faacac`, `7cfed755`, `2399e885`, `55f421d4`,
  `b6a50d3e`.
- Phase 3 proxy: `a1711803`, `fcfd69a8`, `58cfea1a`,
  `c929ca87`.
- Phase 4 commands: `28f6647d` and following, through
  `15b8ed7d` / `54cfe6d5`.
- Phase 5 generation: `648fe0fb` (OpenAI), `a1c6360a`
  (Anthropic), `8ddeb9d0` (Gemini), `92034749`
  (OpenRouter / NanoGPT / Mistral / Cohere / HF / DeepInfra),
  `fe8179bd` (local providers), `5034ff42` (Vertex), and
  the matching translate / TTS / image commits.
- Phase 6 store wiring: `2d99e885`, `fb062b10`,
  `bb5f5201`, `1a161664`.

This roadmap is not bound to those commits. They are useful when
you need to see "how did someone do this in TypeScript" but the
final API shape on `fastify` is set by [`architecture.md`](../architecture.md),
not by their endpoint URLs.

## Notes

- Node 24+ is required for `node:sqlite`. `package.json#engines`
  must widen at the start of Phase 1.
- The Express server stays running until Phase 3 retires it. Until
  then, the SPA still serves through Express in non-dev mode.
