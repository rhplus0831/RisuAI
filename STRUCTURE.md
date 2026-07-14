# Structure Notes

Last audited: 2026-07-14.

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
5. `src/docs/client-runtime.md` - browser Fastify adapters, bootstrap, REST
   resource reads and hydration, generation client, assets/storage/plugins.
6. `docs/structure/server-resources-and-bridges.md` - bootstrap, API-backed
   resource state, lazy hydration, projection epochs, command-local
   acknowledgements, SSE invalidation, bridge watchers.
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
| `.archived-docs/`                                                                                       | Closed workstreams and dated reports grouped under six topic folders. Prefer code and current structure docs for behavior; references to former audit gates are historical. |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts`                                                        | TypeScript, Vitest, and Playwright config.                                                           |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore`                                                     | Container build/run path.                                                                            |
| `.github/`, `.vscode/extensions.json`, `.npmrc`, `.gitattributes`, `.gitignore`, `.ignore`, `.prettierrc.json`, `.prettierignore` | CI/image publishing/moderation, PR metadata, current editor recommendations, install, merge, search ignore, and formatting policy. |
| `README.md`, `version.json`, `LICENSE`                                                                  | Project docs, version metadata, license.                                                            |
| `AGENTS.md`, `CLAUDE.md`, `HANDOVER.md` when present                                                    | Agent workflow and handoff context; use this file for structure before workflow-specific notes.      |
| `dist/`, `data/`, `node_modules/`, `server/fastify/node_modules/`, `coverage/`, `test-results/`, `blobs-for-test/`, `scripts/` when present, `.idea/`, `.claude/`, `.codex-note/` | Generated, runtime, ignored scratch, or local editor/agent state. Do not edit as source. |

## Primary Entrypoints

| Path                                                                                                                                        | Purpose                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`                                                                                                               | API process entrypoint: load config, build app, listen, graceful shutdown/signal handling.                                  |
| `server/fastify/src/app.ts`                                                                                                                 | Fastify composition root: plugins, SQLite, auth, active writer, routes, workers, timers, optional static SPA.               |
| `server/fastify/src/config.ts`, `server/fastify/src/routeRateLimits.ts`                                                                     | Runtime env parsing and per-route rate-limit presets.                                                                       |
| `server/fastify/src/db.ts`                                                                                                                  | SQLite schema v22, migrations, schema version, global revision.                                                             |
| `server/fastify/src/repository.ts`, `server/fastify/src/messageStore.ts`                                                                    | SQLite-backed domain load/write for settings, characters/chats, split collections, legacy `db.json` import/applyImport, asset metadata, backups, and chat message tables. |
| `server/fastify/src/routeManifest.ts`                                                                                                       | Auth, active-writer, streaming, and route classification decisions used by tests/audits. Update it for route changes; use `app.printRoutes()` for the endpoint inventory. |
| `server/fastify/src/routes/`, `server/fastify/src/commands/`                                                                                | `/api/v1/*` route registrars and revision-checked mutation helpers, including scoped row loaders, sparse mutation contracts, and canonical acknowledgement receipts. |
| `server/fastify/src/commands/events.ts`, `server/fastify/src/routes/events.ts`                                                              | Command-event persistence, replay, and live command/memory SSE route.                                                       |
| `server/fastify/src/pushNotifications.ts`, `server/fastify/src/routes/pushNotifications.ts`                                                 | Web Push VAPID key/subscription storage and push subscription routes.                                                       |
| `server/fastify/src/generation/`, `server/fastify/src/prompt/`, `server/fastify/src/routes/generation*.ts`, `server/fastify/src/generationJobs.ts`, `server/fastify/src/generationFinalizationRetry.ts`, `server/fastify/src/messageTranslationJobs.ts`, `server/fastify/src/translation/` | Provider adapters, prompt assembly/effective generation config, Agent Preset execution, Lua hooks/progress, SSE transport, durable chat jobs, finalization retries, detached message translation state and provider dispatch. |
| `server/fastify/src/commands/agentPresets.ts`, `src/ts/agentPresetRecords.ts`, `src/ts/agentPresetReferences.ts`, `src/ts/agentPresetResolver.ts`, `src/ts/agentPresets.ts` | Agent Preset storage contract, output-reference parsing, validation/planning/status, revisioned commands, and browser command helpers. |
| `server/fastify/src/memory*.ts`                                                                                                             | Maintained Hypa V3 memory tables, planning, selection, jobs, worker, events.                                                |
| `server/fastify/src/risuSave/`, `server/fastify/src/realmImport/`                                                                           | `.risu` codecs, bounded inflate, bundles/local-backup import/export, asset reports, and Realm/charx conversion helpers.     |
| `server/fastify/src/streamJobs.ts`, `server/fastify/src/streamBackpressure.ts`                                                              | Process-local proxy stream jobs and shared bounded stream writers.                                                          |
| `src/main.ts`, `src/App.svelte`, `src/ts/bootstrap.ts`                                                                                      | Browser bootstrap, app shell, initial REST resource load, and SSE invalidation startup.                                     |
| `src/lib/`                                                                                                                                  | Svelte UI components by feature area.                                                                                       |
| `src/ts/server/`                                                                                                                            | Browser Fastify adapters: runtime bootstrap, resource reads/state/invalidation, lazy character/chat/lorebook/prompt and preset hydration, commands, events, memory jobs, message translation refresh, bridges, assets, backups, Realm import, push notifications, stale-operation guards, protocol diagnostics, and browser smoke hooks. |
| `src/ts/server/commands.ts`, `src/ts/server/resourceState.svelte.ts`, `src/ts/server/resourceInvalidation.ts`, `src/ts/server/commandLocalEffectEvents.ts` | Shared command queue, per-slice projection epochs, validated contiguous local-effect acknowledgement, authoritative invalidation fallback, and post-apply listeners. |
| `src/ts/server/settingsGroups.ts`, `src/ts/promptSettings.ts`                                                                               | Browser settings-group ownership map, including the isolated prompt group shared by resource reads, invalidation, and settings bridges. |
| `src/ts/chatCommands.ts`, `src/ts/chatGenerationSettings.ts`, `src/ts/server/chatGenerationSettingsResourceGuard.ts`, `src/ts/server/chatStructureHydrationHooks.ts` | Sparse optimistic chat/message and generation-settings commands, plus guards that keep authoritative row/transcript hydration from replacing newer local structure edits. |
| `src/ts/personaMutationCertificate.ts`, `src/ts/server/loadoutCanonical.ts`, `src/ts/server/scriptDefinitionMutations.ts`                   | Canonical-state and digest helpers used to prove compact persona, loadout, and script/trigger mutations without echoing full client projections. |
| `src/ts/process/`, `src/ts/process/request/`                                                                                                | `sendChat`, server-backed generation bridge, request routing, SSE parsing, retained parity helpers.                         |
| `src/ts/storage/`                                                                                                                           | API-backed resource access adapters, server-backed auth/storage, backup helpers, and retained browser `.risu` compatibility codecs; server-backed device backup flows use server routes. |
| `src/ts/plugins/`, `src/ts/pluginCommands.ts`, `src/ts/process/modules.ts`, `src/ts/moduleCommands.ts`, `src/ts/process/mcp/`               | Browser plugin/module runtime, Plugin V3 API host, command-backed plugin/module state, `.risum` import, and MCP clients/tools. |
| `src/ts/model/`, `src/ts/horde/`                                                                                                            | Browser model registry, keyed provider-catalog request caching, and Horde helpers.                                          |
| `src/lib/Setting/Pages/AgentPresetSettings.svelte`, `src/lib/Setting/Pages/AgentPresetEditorDrawer.svelte`, `src/lib/SideBars/ChatGenerationSettingsControls.svelte` | Agent Preset authoring UI and chat-scoped Agent Preset selection.                                                           |
| `src/lang/`, `src/styles.css`, `src/ts/gui/`, `src/ts/setting/`                                                                             | Language packs, global styling/theme variables, GUI size/animation helpers, and data-driven setting definitions.            |
| `src/ts/media/`, `src/ts/parser/`, `src/ts/translator/`, `src/ts/network/`, `src/ts/kei/`, `src/ts/util/`                                  | Focused client helper domains and tests.                                                                                    |

## Standing Conventions

- The live runtime is Fastify-only. `src/ts/platform.ts` sets
  `isFastifyServer = true`; native/mobile wrappers, authoritative browser-local
  persistence, peer sync, Drive sync, and non-Fastify modes are not live. The
  browser does keep a bounded, disposable IndexedDB cache of authenticated REST
  resource values; Fastify remains the source of truth and confirms every reuse
  by SHA-256. The Web Push notification service worker at
  `public/service-worker.js` is live only through
  `src/ts/server/pushNotifications.ts`; legacy share/file-handler/offline
  service-worker surfaces remain no-port.
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
  generation persistence, backups, legacy storage write/remove, and memory job
  create/cancel.
- High-level browser command mutations share one execution queue because every
  domain uses the same server revision. Successful responses may carry compact
  local-effect receipts, but the browser applies one only when its event is
  contiguous and its target, projection epoch, and canonical state still match.
  Missing, malformed, stale, or unsafe receipts retain the normal authoritative
  invalidation/read path; an HTTP success alone is not projection authority.
- Collection reads intentionally return lightweight shells for modern prompt
  presets and legacy bot presets. Hydrate their large owner bodies through the
  dedicated prompt-template or legacy-preset reads, and preserve the existing
  owner/revision/epoch fences when adding a caller.
- Browser resource reads prefer authenticated hash-aware POSTs for settings,
  collections, the message-free character list, prompt templates, legacy preset
  bodies, and character lorebooks. Protocol v2 POST bodies are limited to 1 MiB;
  the client sends bounded SHA-256 inventories, and array responses tag each
  position as either `{hash: sha256}` or `{value: json}`. It reconstructs hits
  from verified IndexedDB entries and falls back to the compatible full GET
  whenever caching is unavailable or untrustworthy. Cache only final
  masked/shell projections, never raw SQLite data or optimistic state. The
  persistent cache keeps at most 512 manifests with 8,192 hashes each and
  32,768 unique entries; UTF-8 serialized JSON is capped at 64 MiB globally and
  32 MiB per value, excluding IndexedDB metadata and engine overhead.
- Settings resource ownership is mirrored between
  `server/fastify/src/routes/commands.ts` and
  `src/ts/server/settingsGroups.ts`; prompt fields use their own `prompt` group.
  Keep those maps and
  `server/fastify/__tests__/settingsGroupParity.test.ts` aligned when moving or
  adding a persisted setting.
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
- Agent Presets are the supported auxiliary-agent orchestration layer. Durable
  `agentPresets` and optional `agentPresetDefaultId` live on `Database`, chats
  select presets through `Chat.generationSettings.agentPresetId`, and loadouts
  can save/restore that selection. Selected prepared inputs are inserted only
  at matching instruction placeholders such as `{{currentUserMessage}}`;
  `mainDraft` is after-main-only. Before-main steps run after submit transforms,
  and their `promptOutput` values feed prompt templates through
  `{{agent::outputKey}}`; any successful step output can feed an eligible later
  step through the same output-key syntax. Before-main consumers can use earlier
  before-main dependency levels; after-main consumers can also use completed
  before-main outputs. Missing, disabled, self, same-level, or future output
  references make the preset `incomplete` and block generation. After-main
  steps run after `editOutput` and before `onOutput`. Steps run by dependency
  level up to preset `maxConcurrency`, can target prompt/intermediate/final
  outputs, and store hidden diagnostics under generation metadata. The legacy
  Context Agent runtime, settings page, `{{agent}}`, and `{{slot::agent}}` are
  removed; old `agentContext*` fields may remain only as inert imported data.
- Root TypeScript is intentionally loose for browser code. Server checking is
  strict and uses the project-reference workflow in `AGENTS.md`.
