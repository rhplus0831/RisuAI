# Structure Notes

Last audited: 2026-06-28.

This is the first-stop map for the Fastify-only RisuAI codebase. Use it for
orientation, then open the focused note under `docs/structure/` or `src/docs/`
for the area you are changing. Historical records under `.archived-docs/` explain
past decisions; they are not the source of current behavior.

## Read Order

1. `STRUCTURE.md` - repo map, entrypoints, and standing conventions.
2. `docs/structure/backend.md` - Fastify composition, route families, commands,
   generation, memory.
3. `src/docs/README.md` - local index for current frontend/client notes.
4. `src/docs/svelte-ui.md` - Svelte UI/UX app shell, routes/stores, components,
   settings, controls, chat/sidebar/mobile/playground, styling, tests.
5. `src/docs/client-runtime.md` - browser Fastify adapters, bootstrap,
   projection/hydration touchpoints, generation client, assets/storage/plugins.
6. `docs/structure/server-projection-and-bridges.md` - bootstrap, projection,
   hydration, SSE reconcile, bridge watchers.
7. `docs/structure/data-and-events.md` - SQLite, auth, active writer, revisions,
   events, streaming.
8. `docs/structure/assets-and-saves.md` - assets, `.risu`, bundle import/export,
   Realm import, backups.
9. `docs/structure/plugins-and-mcp.md` - browser plugin runtime and MCP clients.
10. `docs/structure/providers-and-models.md` - model metadata, provider dispatch,
   server routing gates.
11. `docs/structure/domain-glossary.md` - common terms and no-port concepts.
12. `docs/structure/testing-and-operations.md` - scripts, checks, env, Docker.
13. `docs/structure/generated-and-legacy.md` - generated/local/legacy caveats.

## Top-Level Map

| Path                                                                                                    | Purpose                                                                                              |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`                                                 | Root-only pnpm package, scripts, lockfile, workspace metadata.                                       |
| `STRUCTURE.md`                                                                                          | First-stop repo map, entrypoints, read order, and standing conventions.                              |
| `index.html`, `vite.config.ts`, `src/`                                                                  | Svelte 5 SPA, Vite config, browser runtime.                                                          |
| `src/docs/`                                                                                             | Current frontend/client docs for Svelte UI/UX and browser runtime touchpoints.                       |
| `server/fastify/`                                                                                       | Fastify API, SQLite persistence, route tests, browser smoke tests.                                   |
| `public/`, `resources/`                                                                                 | Vite-copied static assets and packaging icon/splash source images.                                   |
| `util/`                                                                                                 | Tracked helper tools: full-stack dev runner, API flag runner, audits, database analyzer, tsserver wrapper, userscript bridge. |
| `docs/structure/`                                                                                       | Current structure notes for agents; `frontend.md` is a compatibility pointer to `src/docs/`.         |
| `docs/prompt-template-ownership-cleanup/`, `docs/deferred-features*.md`, `docs/ui-flow-stale-state-audit*.md` when present | Open and retained implementation plans, phase routers, and audit progress notes.                     |
| `.archived-docs/`                                                                                       | Closed workstreams and dated reports, including older user-input and stale-state audits. Expect stale present tense; prefer code and `docs/structure/`. |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts`                                                        | TypeScript, Vitest, and Playwright config.                                                           |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore`                                                     | Container build/run path.                                                                            |
| `.github/`, `.vscode/extensions.json`, `.npmrc`, `.gitattributes`, `.gitignore`, `.ignore`, `.prettierrc.json`, `.prettierignore` | Automation, tracked editor recommendation, install, merge, search ignore, and formatting policy.     |
| `README.md`, `version.json`, `LICENSE`                                                                  | Project docs, version metadata, license.                                                            |
| `AGENTS.md`, `CLAUDE.md`, `HANDOVER.md` when present                                                    | Agent workflow and handoff context; use this file for structure before workflow-specific notes.      |
| `dist/`, `data/`, `node_modules/`, `server/fastify/node_modules/`, `coverage/`, `test-results/`, `blobs-for-test/`, `scripts/` when present, `.idea/`, `.claude/`, `.codex-note/` | Generated, runtime, ignored scratch, or local editor/agent state. Do not edit as source. |

## Primary Entrypoints

| Path                                                                                                                                        | Purpose                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`                                                                                                               | API process entrypoint: load config, build app, listen, graceful shutdown/signal handling.                                  |
| `server/fastify/src/app.ts`                                                                                                                 | Fastify composition root: plugins, SQLite, auth, active writer, routes, workers, timers, optional static SPA.               |
| `server/fastify/src/config.ts`, `server/fastify/src/routeRateLimits.ts`                                                                     | Runtime env parsing and per-route rate-limit presets.                                                                       |
| `server/fastify/src/db.ts`                                                                                                                  | SQLite schema v19, migrations, schema version, global revision.                                                             |
| `server/fastify/src/repository.ts`, `server/fastify/src/messageStore.ts`                                                                    | SQLite-backed domain load/write, projections/body cache, legacy `db.json` import/applyImport, asset metadata, backups, chat message tables. |
| `server/fastify/src/routeManifest.ts`                                                                                                       | Auth, active-writer, streaming, and route classification decisions used by tests/audits. Update it for route changes; use `app.printRoutes()` for the endpoint inventory. |
| `server/fastify/src/routes/`, `server/fastify/src/commands/`                                                                                | `/api/v1/*` route registrars and revision-checked mutation helpers.                                                         |
| `server/fastify/src/commands/events.ts`, `server/fastify/src/routes/events.ts`                                                              | Command-event persistence, replay, and live command/memory SSE route.                                                       |
| `server/fastify/src/pushNotifications.ts`, `server/fastify/src/routes/pushNotifications.ts`                                                 | Web Push VAPID key/subscription storage and push subscription routes.                                                       |
| `server/fastify/src/generation/`, `server/fastify/src/prompt/`, `server/fastify/src/routes/generation*.ts`, `server/fastify/src/generationJobs.ts`, `server/fastify/src/generationFinalizationRetry.ts`, `server/fastify/src/messageTranslationJobs.ts` | Provider adapters, prompt assembly/effective generation config, Lua hooks, SSE transport, durable chat jobs, finalization retries, detached message translation state. |
| `server/fastify/src/memory*.ts`                                                                                                             | Maintained Hypa V3 memory tables, planning, selection, jobs, worker, events.                                                |
| `server/fastify/src/risuSave/`, `server/fastify/src/realmImport/`                                                                           | `.risu` codecs, bounded inflate, bundles/local-backup import/export, asset reports, and Realm/charx conversion helpers.     |
| `server/fastify/src/streamJobs.ts`, `server/fastify/src/streamBackpressure.ts`                                                              | Process-local proxy stream jobs and shared bounded stream writers.                                                          |
| `src/main.ts`, `src/App.svelte`, `src/ts/bootstrap.ts`                                                                                      | Browser bootstrap, app shell, Fastify projection startup.                                                                   |
| `src/lib/`                                                                                                                                  | Svelte UI components by feature area.                                                                                       |
| `src/ts/server/`                                                                                                                            | Browser Fastify adapters: bootstrap/body cache, commands, projection/hydration/resync, character/prompt hydration, events, memory job events, bridges, assets, backups, Realm import, protocol diagnostics, browser smoke hooks. |
| `src/ts/process/`, `src/ts/process/request/`                                                                                                | `sendChat`, server-backed generation bridge, request routing, SSE parsing, retained parity helpers.                         |
| `src/ts/storage/`                                                                                                                           | Browser projection state, server-backed auth/storage, backup helpers, and retained browser `.risu` compatibility codecs; server-backed device backup flows use server routes. |
| `src/ts/plugins/`, `src/ts/pluginCommands.ts`, `src/ts/process/mcp/`                                                                        | Browser plugin runtime, Plugin V3 API host, command-backed plugin state helpers, MCP clients/tools.                         |
| `src/ts/model/`, `src/ts/horde/`                                                                                                            | Browser model registry and provider catalog helpers.                                                                        |
| `src/lang/`, `src/styles.css`, `src/ts/gui/`, `src/ts/setting/`                                                                             | Language packs, global styling/theme variables, GUI size/animation helpers, and data-driven setting definitions.            |
| `src/ts/media/`, `src/ts/parser/`, `src/ts/translator/`, `src/ts/network/`, `src/ts/kei/`, `src/ts/util/`                                  | Focused client helper domains and tests.                                                                                    |

## Standing Conventions

- The live runtime is Fastify-only. `src/ts/platform.ts` sets
  `isFastifyServer = true`; native/mobile wrappers, browser-local persistence,
  service workers, peer sync, Drive sync, and non-Fastify modes are not live.
- `pnpm dev:agent` runs the full-stack trace runner on frontend port 6418 and
  API port 6419 with trace mode `agent`, auth bypass, and TOS bypass defaults.
  Stop it when done so those ports are free for the next agent.
- `pnpm dev:human` runs the same runner on frontend port 6002 and API port
  6001 with trace mode `human` and password auth enabled by default.
- Add new routes from `buildApp()` in `server/fastify/src/app.ts`. Handlers
  should call `requireAuth()` unless intentionally public, and every route needs
  a `routeManifest.ts` decision.
- Revision-tracked domain changes should go through command mutations so
  `baseRevision`, revision bumps, and command events stay aligned. Explicit
  server-owned exceptions include import/restore, asset upload, Realm import,
  generation persistence, backups, and memory job create/cancel.
- Server-side prompt assembly is the supported chat-send path. Browser preflight
  uses `resolveServerPromptAssembly()` and model-profile resolution; the shared
  provider capability table is reached through the resolved profile. Unsupported
  shapes hard-fail instead of falling back to browser-local assembly.
- Settings -> Model is profile-first. Durable `modelProfiles`,
  `modelRoleProfiles`, and `modelRuntimeDefaults` are the normal editing and
  generation contract; legacy flat fields such as `aiModel`, `subModel`,
  `modelRoles`, `seperateModels`, `fallbackModels`, separate parameters, and
  provider globals remain compatibility/conversion data behind Advanced Legacy
  Settings or import/preset/loadout paths.
- Root TypeScript is intentionally loose for browser code. Server checking is
  strict and uses the project-reference workflow in `AGENTS.md`.
