# Structure Notes

Last explored: 2026-05-30.

This folder is the present-tense navigation map of the codebase. It is the
companion to the **archived** workstream records in
[`docs/archive/`](../archive/README.md) — the Fastify migration, client thinning,
and durable generation all ran to completion and now live there. Use this folder
when you need to find the right part of the codebase quickly before making a
change, and use [`docs/leftover.md`](../leftover.md) for the still-open items.

## Read Order

1. [`README.md`](README.md) - repo map and standing conventions.
2. [`backend.md`](backend.md) - Fastify entrypoints, routes, generation, memory.
3. [`frontend.md`](frontend.md) - Svelte entrypoints, UI directories, server projection flow.
4. [`data-and-events.md`](data-and-events.md) - persistence split, auth, revisions, SSE.
5. [`domain-glossary.md`](domain-glossary.md) - common Risu domain terms and where they live.
6. [`testing-and-operations.md`](testing-and-operations.md) - scripts, test split, env, Docker.
7. [`generated-and-legacy.md`](generated-and-legacy.md) - generated files and removed/no-port surfaces.

For workstream history and decision records, start with
[`docs/archive/README.md`](../archive/README.md): the Fastify migration
([`archive/fastify/`](../archive/fastify/README.md)), the client-thinning
server-projection workstream ([`archive/client-thinning/`](../archive/client-thinning/README.md)),
and durable generation ([`archive/durable-generation/`](../archive/durable-generation/README.md)).
All three are closed; the archives hold the consolidated invariant contracts, phase
scope docs, and design references.

## Top-Level Map

| Path                             | Purpose                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`    | API process entrypoint; builds the app and listens.                                          |
| `server/fastify/src/app.ts`      | Fastify app factory, plugin setup, route registration, static SPA serving.                   |
| `server/fastify/src/routes/`     | Server route registrars for `/api/v1/*`.                                                     |
| `server/fastify/src/commands/`   | Validators and mutation helpers for command-backed domain resources.                         |
| `server/fastify/src/generation/` | Provider-specific completion adapters.                                                       |
| `server/fastify/src/prompt/`     | Prompt assembly (`assemble.ts`), lorebook, triggers, tokenizer, provider dispatch, the server Lua VM (`luaRuntime.ts`), and the A2 post-generation pass (`runServerPostGeneration`). |
| `server/fastify/src/generationJobs.ts` | Durable-generation job registry (`GenerationJobRegistry`): detached, reattachable chat-generation jobs that survive client disconnect. |
| `server/fastify/src/memory*.ts`  | Hypa V3 memory tables, planning, repository, job handlers, and worker.                       |
| `src/main.ts`                    | Browser SPA bootstrap.                                                                       |
| `src/App.svelte`                 | Main Svelte shell and top-level render switch.                                               |
| `src/lib/`                       | Svelte component directories.                                                                |
| `src/ts/`                        | Client/domain logic: storage, server adapters, parser, plugins, generation, media, settings. |
| `src/ts/process/request/`        | Browser-side request routing: the server-vs-local classifiers (`serverPromptAssembly.ts`, `durableGeneration.ts`), the shared `providerCapability.ts` table, and the `/chat` SSE adapter (`serverChat.ts`). |
| `src/ts/server/`                 | Browser-side Fastify adapters for bootstrap, commands, assets, events, backups.              |
| `src/ts/storage/`                | Client database state, server-backed storage auth, `.risu` import/export helpers.            |
| `public/`                        | Static source assets copied by Vite.                                                         |
| `dist/`                          | Generated Vite output; do not hand-edit.                                                     |
| `docs/leftover.md`               | Live tracker of decisions-needed and intentionally-deferred items across the closed workstreams. |
| `docs/archive/`                  | Closed workstream records: `fastify/` migration, `client-thinning/`, and `durable-generation/`. |

## Standing Conventions

- Use `pnpm`; the project lockfile is `pnpm-lock.yaml`.
- Node.js 24+ is required.
- Fastify is the only supported runtime. Old native/mobile wrappers, browser-side
  persistence modes, service worker behavior, peer sync, Drive sync, and removed
  memory engines are not targets for new work.
- There are no Fastify compatibility migrations for legacy web/runtime modes.
  SQLite schema migrations do exist in `server/fastify/src/db.ts`; keep that
  distinction clear when changing persisted server data.
- New Fastify routes should be registered from `buildApp()` in
  `server/fastify/src/app.ts` and should call `requireAuth()` explicitly unless
  the route is intentionally public.
- Revision-tracked `data/db.json` mutations should go through the command
  mutation path so `baseRevision`, revision bumps, and command events stay in sync.
  Generation is the exception: `/api/v1/generate/chat` is a server-owned mutation
  route that persists assembly-time + post-generation scriptstate (and, on the
  durable path, the assistant message) directly via `applyJsonCommandMutation`.
- Server-side prompt assembly is the default Fastify path: `useServerPromptAssembly`
  defaults `true`, so a supported send is classified by `resolveServerPromptAssembly`
  + the shared `resolveProviderCapability` table and routed to the server assembler;
  unsupported shapes hard-fail (no silent browser fallback). The browser assembles
  locally only when `!isFastifyServer` or a test sets the flag `false`.
- Root TypeScript is intentionally loose for browser code; `server/fastify` has
  its own strict TypeScript config.
