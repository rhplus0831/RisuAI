# Structure Notes

Last audited: 2026-06-08.

This is the first-stop map for the Fastify-only RisuAI codebase. Use it for
orientation, then open the focused note under `docs/structure/` for the area you
are changing. Historical records under `docs/archive/` explain past decisions;
they are not the source of current behavior.

## Read Order

1. `STRUCTURE.md` - repo map, entrypoints, and standing conventions.
2. `docs/structure/backend.md` - Fastify composition, route families, commands,
   generation, memory.
3. `docs/structure/frontend.md` - Svelte app, client directories, generation
   client.
4. `docs/structure/server-projection-and-bridges.md` - bootstrap, projection,
   hydration, SSE reconcile, bridge watchers.
5. `docs/structure/data-and-events.md` - SQLite, auth, active writer, revisions,
   events, streaming.
6. `docs/structure/assets-and-saves.md` - assets, `.risu`, bundle import/export,
   Realm import, backups.
7. `docs/structure/plugins-and-mcp.md` - browser plugin runtime and MCP clients.
8. `docs/structure/providers-and-models.md` - model metadata, provider dispatch,
   server routing gates.
9. `docs/structure/domain-glossary.md` - common terms and no-port concepts.
10. `docs/structure/testing-and-operations.md` - scripts, checks, env, Docker.
11. `docs/structure/generated-and-legacy.md` - generated/local/legacy caveats.

## Top-Level Map

| Path                                                                                                    | Purpose                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`                                                 | Root-only pnpm package, scripts, lockfile, workspace metadata.                                       |
| `index.html`, `vite.config.ts`, `src/`                                                                  | Svelte 5 SPA, Vite config, browser runtime.                                                          |
| `server/fastify/`                                                                                       | Fastify API, SQLite persistence, route tests, browser smoke tests.                                   |
| `public/`, `resources/`                                                                                 | Vite-copied static assets and packaging icon/splash source images.                                   |
| `util/`                                                                                                 | Tracked helper tools: API flag runner, audits, database analyzer, userscript bridge.                 |
| `docs/structure/`                                                                                       | Current structure notes for agents.                                                                  |
| `docs/archive/`                                                                                         | Closed workstreams and dated reports. Expect stale present tense; prefer code and `docs/structure/`. |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts`                                                        | TypeScript, Vitest, and Playwright config.                                                           |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore`                                                     | Container build/run path.                                                                            |
| `.github/`, `.vscode/`, `.npmrc`, `.gitattributes`, `.gitignore`, `.prettierrc.json`, `.prettierignore` | Automation, editor, install, merge, ignore, and formatting policy.                                   |
| `README.md`, `plugins.md`, `version.json`, `LICENSE`                                                    | Project docs, plugin API notes, version metadata, license.                                           |
| `AGENTS.md`, `CLAUDE.md`, `HANDOVER.md` when present                                                    | Agent and handoff context. Read `AGENTS.md` first.                                                   |
| `dist/`, `data/`, `node_modules/`, `test-results/`, `scripts/` when present, `.idea/`, `.claude/`       | Generated, runtime, ignored scratch, or local editor/agent state. Do not edit as source.             |

## Primary Entrypoints

| Path                                                                                                                                        | Purpose                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`                                                                                                               | API process entrypoint: load config, build app, listen.                                                                     |
| `server/fastify/src/app.ts`                                                                                                                 | Fastify composition root: plugins, SQLite, auth, active writer, routes, workers, timers, optional static SPA.               |
| `server/fastify/src/config.ts`, `server/fastify/src/routeRateLimits.ts`                                                                     | Runtime env parsing and per-route rate-limit presets.                                                                       |
| `server/fastify/src/db.ts`                                                                                                                  | SQLite schema v15, migrations, schema version, global revision.                                                             |
| `server/fastify/src/repository.ts`, `server/fastify/src/messageStore.ts`                                                                    | SQLite-backed domain repository, asset metadata, imports/exports/backups, chat message tables.                              |
| `server/fastify/src/routeManifest.ts`                                                                                                       | Auth, active-writer, streaming, and route inventory used by tests/audits. Update it for route changes.                      |
| `server/fastify/src/routes/`, `server/fastify/src/commands/`                                                                                | `/api/v1/*` route registrars and revision-checked mutation helpers.                                                         |
| `server/fastify/src/generation/`, `server/fastify/src/prompt/`, `server/fastify/src/generationJobs.ts`                                      | Provider adapters, prompt assembly, Lua hooks, SSE transport, durable chat jobs.                                            |
| `server/fastify/src/memory*.ts`                                                                                                             | Maintained Hypa V3 memory tables, planning, selection, jobs, worker, events.                                                |
| `server/fastify/src/risuSave/`, `server/fastify/src/realmImport/`                                                                           | `.risu` codecs/bundles/asset reports and Realm/charx import conversion.                                                     |
| `src/main.ts`, `src/App.svelte`, `src/ts/bootstrap.ts`                                                                                      | Browser bootstrap, app shell, Fastify projection startup.                                                                   |
| `src/lib/`                                                                                                                                  | Svelte UI components by feature area.                                                                                       |
| `src/ts/server/`                                                                                                                            | Browser Fastify adapters: bootstrap, commands, projection/hydration/resync, events, bridges, assets, backups, Realm import. |
| `src/ts/process/`, `src/ts/process/request/`                                                                                                | `sendChat`, server-backed generation bridge, request routing, SSE parsing, retained parity helpers.                         |
| `src/ts/storage/`                                                                                                                           | Browser projection state, server-backed auth/storage, `.risu` and backup helpers.                                           |
| `src/ts/plugins/`, `src/ts/process/mcp/`                                                                                                    | Browser plugin runtime, Plugin V3 API host, MCP clients/tools.                                                              |
| `src/ts/model/`, `src/ts/horde/`                                                                                                            | Browser model registry and provider catalog helpers.                                                                        |
| `src/ts/media/`, `src/ts/parser/`, `src/ts/gui/`, `src/ts/setting/`, `src/ts/translator/`, `src/ts/network/`, `src/ts/kei/`, `src/ts/util/` | Focused client helper domains and tests.                                                                                    |

## Standing Conventions

- Use `pnpm`. Node.js 24+ is required.
- The live runtime is Fastify-only. `src/ts/platform.ts` sets
  `isFastifyServer = true`; native/mobile wrappers, browser-local persistence,
  service workers, peer sync, Drive sync, and non-Fastify modes are not live.
- Vite dev (`pnpm dev`) serves the SPA on port 5174 and proxies `/api` to the
  API server. Run `pnpm api:dev` or `pnpm api:dev:flag` separately.
- If an agent-run API server is expected on port `6002` and the port is already
  open, try `touch .risu-api-restart` for the flag-gated runner before starting
  another server.
- Add new routes from `buildApp()` in `server/fastify/src/app.ts`. Handlers
  should call `requireAuth()` unless intentionally public, and every route needs
  a `routeManifest.ts` decision.
- Revision-tracked domain changes should go through command mutations so
  `baseRevision`, revision bumps, and command events stay aligned. Explicit
  server-owned exceptions include import/restore, asset upload, Realm import,
  generation persistence, backups, and memory job create/cancel.
- Server-side prompt assembly is the supported chat-send path. Browser preflight
  uses `resolveServerPromptAssembly()` plus `resolveProviderCapability()`;
  unsupported shapes hard-fail instead of falling back to browser-local assembly.
- Root TypeScript is intentionally loose for browser code. Server checking is
  strict and uses the project-reference workflow in `AGENTS.md`.
