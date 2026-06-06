# Structure Notes

Last audited: 2026-06-05.

This is the quick navigation map for the Fastify-only RisuAI codebase. Use it
first, then open the focused note under `docs/structure/` for the area you are
about to touch. Historical workstream records live under `docs/archive/`; they
explain decisions but are not the source of present-tense behavior.

## Read Order

1. `STRUCTURE.md` - repo map, entrypoints, and standing conventions.
2. `docs/structure/backend.md` - Fastify app, routes, prompt generation, memory.
3. `docs/structure/frontend.md` - Svelte app, client directories, generation client.
4. `docs/structure/server-projection-and-bridges.md` - bootstrap, hydration, SSE
   reconcile, bridge watchers.
5. `docs/structure/data-and-events.md` - persistence split, auth, revisions,
   active writer, streaming.
6. `docs/structure/assets-and-saves.md` - assets, `.risu` import/export, backups.
7. `docs/structure/plugins-and-mcp.md` - browser plugin runtime and MCP clients.
8. `docs/structure/providers-and-models.md` - provider dispatch and model routing.
9. `docs/structure/domain-glossary.md` - common domain terms and no-port concepts.
10. `docs/structure/testing-and-operations.md` - scripts, checks, env, Docker.
11. `docs/structure/generated-and-legacy.md` - generated/local/legacy caveats.

## Top-Level Map

| Path                                                                                              | Purpose                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`                                           | pnpm scripts, locked dependency graph, and allowed native build metadata.                                                  |
| `index.html`, `vite.config.ts`, `src/`                                                            | Svelte 5 browser app and Vite build/dev config.                                                                            |
| `server/fastify/`                                                                                 | Fastify API, persistence, generation, memory, server tests, browser smoke.                                                 |
| `public/`, `resources/`                                                                           | Source static assets copied by Vite plus app icon/splash resources.                                                        |
| `util/`                                                                                           | Tracked helper tools and source fixtures: architecture audit, database analyzer, flag-gated API runner, userscript bridge. |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts`                                                  | TypeScript, Vitest, and Playwright config.                                                                                 |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore`                                               | Container build/run path. `.dockerignore` currently ignores only `node_modules`.                                           |
| `.github/`, `.vscode/`, `.npmrc`, `.gitattributes`, `.gitignore`                                  | Repo automation, editor recommendations, install/merge/ignore policy.                                                      |
| `README.md`, `plugins.md`, `version.json`, `LICENSE`                                              | Project-facing docs, plugin notes, package version metadata, license.                                                      |
| `AGENTS.md`, `CLAUDE.md`, `HANDOVER.md`                                                           | Agent/local handoff context.                                                                                               |
| `docs/structure/`                                                                                 | Current focused structure notes.                                                                                           |
| `docs/archive/`                                                                                   | Closed workstream records and dated reports, including the archived v2 stability/performance plan. There is no current open `docs/plan/` workstream. Prefer `STRUCTURE.md` and `docs/structure/` for current state. |
| `dist/`, `data/`, `node_modules/`, `test-results/`, `scripts/` when present, `.idea/`, `.claude/` | Generated, local runtime/test output, ignored scratch, or local editor/agent state; do not hand-edit as source.            |

## Runtime Entrypoints

| Path                                                           | Purpose                                                                                                                                                 |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`                                  | API process entrypoint; builds the app and listens.                                                                                                     |
| `server/fastify/src/app.ts`                                    | Fastify app factory: plugins, SQLite, auth, active-writer guard, route registration, workers/timers, optional static SPA.                               |
| `server/fastify/src/routes/`                                   | `/api/v1/*` route registrars. Each route makes an explicit auth decision.                                                                               |
| `server/fastify/src/routeManifest.ts`                          | Auth, active-writer, streaming, and route inventory used by tests/audits. Update it for new routes.                                                     |
| `server/fastify/src/db.ts`                                     | SQLite schema v15, schema version, global revision, command-event history, memory/message/finalization tables.                                          |
| `server/fastify/src/repository.ts`                             | SQLite-backed domain repository, asset metadata, legacy `db.json` import, imports/restores/backups, projection stubs, message join/split.               |
| `server/fastify/src/commands/`                                 | Resource validators and mutation helpers for command-backed state.                                                                                      |
| `server/fastify/src/generation/`, `server/fastify/src/prompt/` | Provider adapters, prompt assembly, Lua hooks, provider transport, post-generation.                                                                     |
| `server/fastify/src/generationJobs.ts`                         | Detached/re-attachable durable chat generation jobs.                                                                                                    |
| `server/fastify/src/memory*.ts`                                | Hypa V3 memory tables, planning, selection, jobs, worker, events.                                                                                       |
| `server/fastify/src/risuSave/`                                 | `.risu` codecs, bundle import/export, asset-reference reports.                                                                                          |
| `src/main.ts`                                                  | Browser SPA bootstrap.                                                                                                                                  |
| `src/App.svelte`                                               | Main Svelte shell and top-level render switch.                                                                                                          |
| `src/lib/`                                                     | Svelte component directories.                                                                                                                           |
| `src/ts/server/`                                               | Browser Fastify adapters: bootstrap, commands, projection/hydration/resync, assets, backups, events, bridges, memory events, Realm import, smoke hooks. |
| `src/ts/process/`                                              | `sendChat`, request routing, retained browser-local parity helpers, MCP/files, memory/PDF/embedding helpers, post-generation, reattach.                 |
| `src/ts/storage/`                                              | Client projection state, server-backed storage/auth, `.risu` and backup helpers.                                                                        |
| `src/ts/model/`, `src/ts/process/request/`                     | Browser model registry plus shared provider/server-routing classifiers.                                                                                 |

## Standing Conventions

- Use `pnpm`. Node.js 24+ is required.
- The live runtime is Fastify-only. `src/ts/platform.ts` sets
  `isFastifyServer = true`; there are no selectable native/mobile,
  browser-local persistence, service-worker, peer-sync, Drive-sync, or
  non-Fastify modes.
- Vite dev (`pnpm dev`) still runs Fastify-backed browser code and proxies
  `/api` to the API server. Run `pnpm api:dev` or `pnpm api:dev:flag` separately.
- If an agent-run API server is expected on port `6002` and the port is already
  open, try `touch .risu-api-restart` for the flag-gated runner before starting
  another server.
- Add new Fastify routes from `buildApp()` in `server/fastify/src/app.ts`.
  Route handlers should call `requireAuth()` unless intentionally public, and
  every route needs a `routeManifest.ts` decision.
- Revision-tracked domain database changes should go through command mutations
  so `baseRevision`, revision bumps, and command events stay aligned. Explicit
  server-owned mutation exceptions include import/restore, asset upload,
  Realm import, generation persistence, and memory job create/cancel.
- Server-side prompt assembly is the supported chat-send path. Browser preflight
  uses `resolveServerPromptAssembly` plus `resolveProviderCapability`; unsupported
  shapes hard-fail instead of falling back to browser-local assembly.
- Root TypeScript is intentionally loose for browser code. Server checking is
  strict and uses the project-reference workflow in `AGENTS.md`.
