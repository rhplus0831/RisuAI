# Structure Notes

Last audited: 2026-07-17.

This is the first-stop map for the Fastify-only RisuAI codebase. The supported
toolchain is Node.js 24 or newer with pnpm. Read this file once, then follow the
task link below; the focused notes are designed to be opened independently.
Historical records under [`.archived-docs/`](.archived-docs/README.md) explain
past decisions but are not sources of current behavior.

## Choose By Task

| Task | Read next |
| --- | --- |
| Find the owner of an unfamiliar area | [`docs/structure/README.md`](docs/structure/README.md) and the [domain glossary](docs/structure/domain-glossary.md) |
| Change Fastify composition, auth, routes, commands, or workers | [Backend map](docs/structure/backend.md) |
| Change SQLite, revisions, active-writer rules, events, or streaming | [Data and events](docs/structure/data-and-events.md) |
| Change browser bootstrap, resource reads, durable mutations, invalidation, or bridges | [Server resources and bridges](docs/structure/server-resources-and-bridges.md), then [client runtime](src/docs/client-runtime.md) |
| Change Svelte UI, navigation, settings controls, chat, sidebars, or styling | [Svelte UI guide](src/docs/svelte-ui.md) |
| Change model profiles, prompt assembly, generation, or provider behavior | [Providers and models](docs/structure/providers-and-models.md) |
| Change modules, plugins, network permissions, or MCP | [Plugins and MCP](docs/structure/plugins-and-mcp.md) |
| Change assets, imports, exports, saves, backups, or Realm conversion | [Assets and saves](docs/structure/assets-and-saves.md) |
| Run or extend checks, local dev, CI, or Docker | [Testing and operations](docs/structure/testing-and-operations.md) |
| Decide whether a path is generated, vendored, compatibility-only, or removed | [Generated and legacy](docs/structure/generated-and-legacy.md) |

## Top-Level Map

| Path | Purpose |
| --- | --- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Root package and scripts, lockfile, and dependency-build allowlist. This is not a multi-package pnpm workspace. |
| `index.html`, `vite.config.ts`, `src/` | Svelte 5 SPA, Vite configuration, browser runtime, UI, language files, and static bundled data. |
| `server/fastify/` | Fastify API, SQLite persistence, provider execution, route tests, and browser smoke tests. There is no separate server package manifest. |
| `docs/structure/`, `src/docs/` | Current agent-facing architecture notes. Start at the [structure-doc index](docs/structure/README.md). |
| `.archived-docs/` | Indexed closed workstreams and dated reports. Do not infer current behavior from them. |
| `public/`, `resources/` | Vite static sources and packaging icon/splash sources. Runtime assets live under `data/`, not here. |
| `util/` | Full-stack dev runners, database analyzer, tsserver wrapper, API-flag runner, and userscript bridge. |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts` | TypeScript, Vitest, and Playwright configuration. |
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | Container build and run path. |
| `.github/workflows/quality.yml` | Node 24 quality CI for pull requests and `main`; it runs the complete `pnpm test:all` lane. |
| `.vscode/`, `.npmrc`, `.gitattributes`, `.gitignore`, `.ignore`, `.prettier*` | Editor, install, merge, search-ignore, and formatting policy. |
| `README.md`, `version.json`, `LICENSE`, `AGENTS.md` | Project metadata and contributor/agent workflow. |
| `dist/`, `data/`, `node_modules/`, `coverage/`, `test-results/` and local scratch paths | Generated or runtime state, not source. See [generated and legacy](docs/structure/generated-and-legacy.md). |

## Runtime Entrypoints

| Path | Responsibility |
| --- | --- |
| `index.html` -> `src/main.ts` | Loads the browser application. |
| `src/App.svelte` | Svelte application shell and top-level render routing. |
| `src/ts/bootstrap.ts` | Auth/writer bootstrap, durable-mutation recovery, initial resource hydration, and invalidation startup. |
| `server/fastify/src/index.ts` | Loads configuration, builds the API, listens, and handles shutdown. |
| `server/fastify/src/app.ts` | Fastify composition root: plugins, SQLite, auth, active writer, routes, jobs, timers, and optional static SPA. |

## Area Map

| Area | Primary code |
| --- | --- |
| Server configuration and route policy | `server/fastify/src/config.ts`, `server/fastify/src/routeManifest.ts`, `server/fastify/src/routeRateLimits.ts`, `server/fastify/src/routes/` |
| Persistence and defaults | `server/fastify/src/db.ts`, `server/fastify/src/databaseDefaults.ts`, `server/fastify/src/databaseLineage.ts`, `server/fastify/src/repository.ts`, `server/fastify/src/messageStore.ts` |
| Revisioned commands and idempotency | `server/fastify/src/commands/`, `server/fastify/src/commandMutationReceipts.ts`, `server/fastify/src/commands/events.ts`, `server/fastify/src/routes/events.ts` |
| Generation, prompt assembly, translation, and memory | `server/fastify/src/generation/`, `server/fastify/src/prompt/`, `server/fastify/src/translation/`, `server/fastify/src/generationJobs.ts`, `server/fastify/src/memory*.ts`, `server/fastify/src/routes/generation.ts`, `server/fastify/src/routes/generationChat.ts` |
| Fixed server-owned provider/media operations | `server/fastify/src/providerOperations.ts`, `server/fastify/src/embeddingOperations.ts`, `server/fastify/src/imageGeneration.ts`, `server/fastify/src/openAITranscription.ts`, `server/fastify/src/tts.ts`, `server/fastify/src/mcpOAuthRefresh.ts`, and paired browser adapters under `src/ts/server/` |
| Permissioned plugin network egress | `src/ts/plugins/pluginNetworkAccess.ts`, `server/fastify/src/routes/proxy.ts`, and `server/fastify/src/pluginNetwork.ts`; see [plugins and MCP](docs/structure/plugins-and-mcp.md) |
| Saves and imports | `server/fastify/src/risuSave/`, `server/fastify/src/realmImport/`, `server/fastify/src/routes/assets.ts`, `server/fastify/src/routes/save.ts`, `server/fastify/src/routes/backups.ts`, `server/fastify/src/routes/realmImport.ts`, and compatibility codecs under `src/ts/storage/` |
| Browser server state | `src/ts/server/resourceState.svelte.ts`, `src/ts/server/resourceInvalidation.ts`, `src/ts/server/commands.ts`, `src/ts/server/settingsGroups.ts` |
| Durable browser mutation recovery | `src/ts/server/pendingMutationOutbox.ts`, `src/ts/server/durableMutationDispatch.ts`, `src/ts/server/pendingMutationReplay.ts` |
| Browser generation and extensions | `src/ts/process/`, `src/ts/model/`, `src/ts/plugins/`, `src/ts/process/modules.ts`, `src/ts/process/mcp/` |
| UI and presentation | `src/lib/`, `src/lang/`, `src/styles.css`, `src/ts/gui/`, `src/ts/setting/` |

## Standing Conventions

- The live runtime is Fastify-only (`src/ts/platform.ts`). Native/mobile
  wrappers, authoritative browser-local persistence, peer sync, Drive sync,
  and non-Fastify modes are not live.
- SQLite is authoritative. The browser resource cache is a disposable,
  hash-verified read cache. The IndexedDB mutation outbox instead carries
  AES-GCM-encrypted intent payloads plus plaintext scope/order and receipt-cleanup
  records for already-staged writes; neither store is an independent app
  database. Bootstrap replays or conclusively disposes pending mutations before
  loading authoritative resources so older reads cannot replace retained local
  intent.
- Do not conflate three mutation records: the browser outbox holds durable
  intent, `command_mutation_receipts` provides lineage-scoped server
  idempotency, and compact local-effect acknowledgements let the current client
  advance a projection only when revision, target, epoch, and canonical-state
  checks pass. Unsafe or missing local effects fall back to invalidation/read.
- Revision-tracked domain changes go through command mutations. Browser commands
  share the global revision ordering, while durable semantic dependency lanes
  preserve predecessor order across crashes and tabs. Server-owned exceptions
  are catalogued in [data and events](docs/structure/data-and-events.md#server-owned-exceptions).
- Add routes through `buildApp()` in `server/fastify/src/app.ts`. Require auth
  unless the route is deliberately public, classify it in `routeManifest.ts`,
  choose a rate-limit preset, and update route-protection tests.
- Stored provider credentials remain server-side and browser-visible values stay
  masked. New provider/media helpers should expose fixed, validated, bounded
  operations rather than arbitrary upstream URLs or headers.
- Collection reads may return lightweight shells. Preserve the existing
  owner/revision/projection-epoch fences when adding prompt, preset, character,
  chat, or lorebook hydration.
- Settings ownership is mirrored by
  `server/fastify/src/routes/commands.ts`,
  `server/fastify/src/databaseDefaults.ts`, and
  `src/ts/server/settingsGroups.ts`. Update the maps, defaults, and
  `server/fastify/__tests__/settingsGroupParity.test.ts` together.
- Server-side prompt assembly and resolved model profiles are the supported chat
  path. Legacy flat model fields are conversion/compatibility data. Agent
  Presets are the auxiliary-agent orchestration layer; their detailed execution
  contract belongs in [providers and models](docs/structure/providers-and-models.md).
- Put new user-visible frontend strings under `src/lang`; do not hard-code an
  English-only UI label.
- `pnpm test` runs the frontend Vitest lane only. Use the task-specific commands
  or `pnpm test:all` described in [testing and operations](docs/structure/testing-and-operations.md).
  Root browser/Svelte checking is intentionally loose; strict server checking
  uses `pnpm exec tsc -p tsconfig.client-lib.json` followed by
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- `pnpm dev:agent` runs the trace-enabled full stack on ports 6418/6419 with
  agent auth/TOS bypass. Stop it when finished. `pnpm dev:human` uses
  ports 6002/6001 with normal password auth defaults.
