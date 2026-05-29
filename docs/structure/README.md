# Structure Notes

Last explored: 2026-05-28.

This folder is a navigation-first companion to the active client-thinning docs
in [`docs/client-thinning/`](../client-thinning/README.md) and the archived
Fastify migration docs in [`docs/archive/fastify/`](../archive/fastify/README.md).
Use it when you need to find the right part of the codebase quickly before
making a change.

## Read Order

1. [`README.md`](README.md) - repo map and standing conventions.
2. [`backend.md`](backend.md) - Fastify entrypoints, routes, generation, memory.
3. [`frontend.md`](frontend.md) - Svelte entrypoints, UI directories, server projection flow.
4. [`data-and-events.md`](data-and-events.md) - persistence split, auth, revisions, SSE.
5. [`domain-glossary.md`](domain-glossary.md) - common Risu domain terms and where they live.
6. [`testing-and-operations.md`](testing-and-operations.md) - scripts, test split, env, Docker.
7. [`generated-and-legacy.md`](generated-and-legacy.md) - generated files and removed/no-port surfaces.

For active client-thinning work, start with
[`docs/client-thinning/README.md`](../client-thinning/README.md). For migration
background, start with
[`docs/archive/fastify/README.md`](../archive/fastify/README.md). The
Fastify migration is closed; that archive holds the consolidated
invariant contract, phase scope docs, and design references.

## Top-Level Map

| Path                             | Purpose                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`    | API process entrypoint; builds the app and listens.                                          |
| `server/fastify/src/app.ts`      | Fastify app factory, plugin setup, route registration, static SPA serving.                   |
| `server/fastify/src/routes/`     | Server route registrars for `/api/v1/*`.                                                     |
| `server/fastify/src/commands/`   | Validators and mutation helpers for command-backed domain resources.                         |
| `server/fastify/src/generation/` | Provider-specific completion adapters.                                                       |
| `server/fastify/src/prompt/`     | Prompt assembly, lorebook, trigger, tokenizer, and provider dispatch plumbing.               |
| `server/fastify/src/memory*.ts`  | Hypa V3 memory tables, planning, repository, job handlers, and worker.                       |
| `src/main.ts`                    | Browser SPA bootstrap.                                                                       |
| `src/App.svelte`                 | Main Svelte shell and top-level render switch.                                               |
| `src/lib/`                       | Svelte component directories.                                                                |
| `src/ts/`                        | Client/domain logic: storage, server adapters, parser, plugins, generation, media, settings. |
| `src/ts/server/`                 | Browser-side Fastify adapters for bootstrap, commands, assets, events, backups.              |
| `src/ts/storage/`                | Client database state, server-backed storage auth, `.risu` import/export helpers.            |
| `public/`                        | Static source assets copied by Vite.                                                         |
| `dist/`                          | Generated Vite output; do not hand-edit.                                                     |
| `docs/client-thinning/`          | Active client-thinning workstream docs: status, plan, phases, coverage, prompts.             |
| `docs/archive/fastify/`          | Archived Fastify migration: invariant contract, phase scope docs, architecture, coverage.    |

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
- Root TypeScript is intentionally loose for browser code; `server/fastify` has
  its own strict TypeScript config.
