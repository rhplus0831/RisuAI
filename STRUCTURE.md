# Project Structure

Last audited: 2026-08-13.

Use this file to orient yourself in the Fastify-only RisuAI codebase. The
supported toolchain is Node.js 24 or newer with pnpm. Choose the guide for your
task below; each guide is self-contained. [Archived documentation](.archived-docs/README.md)
records past decisions and is not authoritative.

## Choose By Task

| Task | Read next |
| ---- | --------- |
| Locate unfamiliar code | [Architecture Index](docs/structure/README.md) and [Domain Glossary](docs/structure/domain-glossary.md#cross-layer-ownership) |
| Change Fastify composition, auth, route policy, workers, timers, or Web Push | [Backend Map](docs/structure/backend.md#route-family-index) |
| Change SQLite, revisions, active-writer rules, command events, or command-event SSE | [Data And Events](docs/structure/data-and-events.md#resource-persistence-and-event-ordering) |
| Change browser resources, hydration, caches, invalidation, or durable mutations | [Server Resources And Bridges](docs/structure/server-resources-and-bridges.md#hydration-workflows), then [Client Runtime](src/docs/client-runtime.md#server-resources-and-durable-mutations) |
| Change reload-durable composer or module-editor draft recovery | [Client Runtime](src/docs/client-runtime.md#draft-recovery-stores), then [Svelte Chat UI](src/docs/svelte-chat-ui.md#composer-layout-modes-and-mobile-viewport) |
| Change chat, transcript, message, composer, or generation UI | [Svelte Chat UI](src/docs/svelte-chat-ui.md#chat-surface-ownership) |
| Change sidebars, routes, chat lists, character selection, or reordering UI | [Svelte Navigation UI](src/docs/svelte-navigation-ui.md#sidebar-and-route-ownership) |
| Change settings routing, data-driven rows, authoring pages, or provider panels | [Svelte Settings UI](src/docs/svelte-settings-ui.md#shell-and-routed-pages) |
| Change shared controls, accessibility, modal focus, or focus restoration | [Svelte Settings UI](src/docs/svelte-settings-ui.md#shared-controls-and-focus) |
| Change the app shell, styling/themes, responsive/Lite behavior, or Playground | [Svelte UI](src/docs/svelte-ui.md) |
| Change frontend localization or language settings | [Svelte UI](src/docs/svelte-ui.md#localization) and [Svelte Settings UI](src/docs/svelte-settings-ui.md#data-driven-rows) |
| Change model profiles, credentials, providers, capabilities, or runtime options | [Providers And Models](docs/structure/providers-and-models.md#model-profiles-and-role-resolution), then [Svelte Settings UI](src/docs/svelte-settings-ui.md#model-profiles-and-provider-panels) for editor behavior |
| Change prompt configuration, assembly order, templates, lorebook injection, or budget gates | [Prompt Assembly And Scripting](docs/structure/prompt-assembly-and-scripting.md#effective-configuration-and-assembly-order), then [Svelte Settings UI](src/docs/svelte-settings-ui.md#agent-and-prompt-authoring) for editor behavior |
| Change Hypa V3 memory selection, summaries, embeddings, or memory jobs | [Prompt Assembly And Scripting](docs/structure/prompt-assembly-and-scripting.md#hypa-v3-memory-phase) and [Backend Map](docs/structure/backend.md#generation-and-background-work) |
| Change CBS/history parsing, regex scripts, triggers, or Lua runtime behavior | [Prompt Assembly And Scripting](docs/structure/prompt-assembly-and-scripting.md#cbs-variables-and-history) and its [Lua Runtime](docs/structure/prompt-assembly-and-scripting.md#lua-runtime) section |
| Change translator presets, translation caches/jobs, or automatic translation | [Translation And Input Hooks](docs/structure/translation-and-input-hooks.md#translator-preset-pipeline), [Svelte Settings UI](src/docs/svelte-settings-ui.md#data-driven-rows), and [Svelte Chat UI](src/docs/svelte-chat-ui.md#message-rendering) |
| Change Draft/BTW input-hook authoring, model selection, or execution | [Translation And Input Hooks](docs/structure/translation-and-input-hooks.md#draft-and-btw-input-hooks), [Svelte Settings UI](src/docs/svelte-settings-ui.md#input-hook-authoring), and [Svelte Chat UI](src/docs/svelte-chat-ui.md#input-hook-chat-controls) |
| Change Agents, Agent Presets, prepared inputs, dependencies, or output composition | [Agents And Presets](docs/structure/agents-and-presets.md#selection-and-readiness), then [Svelte Settings UI](src/docs/svelte-settings-ui.md#agent-and-prompt-authoring) for editor behavior |
| Diagnose runtime traces, generation telemetry, or LLM request history | [Testing And Operations](docs/structure/testing-and-operations.md#request-and-generation-tracing) and [Providers And Models](docs/structure/providers-and-models.md#llm-request-history) |
| Change modules, plugins, network permissions, or MCP | [Plugins And MCP](docs/structure/plugins-and-mcp.md) |
| Change assets, the inlay catalog, `.risu`/CharX/chat exchange, post-export reset, backups, or Realm conversion | [Assets And Saves](docs/structure/assets-and-saves.md), then [Server Resources And Bridges](docs/structure/server-resources-and-bridges.md#collection-and-cache-bounds) for browser catalog reads |
| Run or extend checks, local dev, or CI | [Testing And Operations](docs/structure/testing-and-operations.md#tests-and-checks) and the [Test Suite Guide](docs/tests/README.md) |
| Trace data-dependent rendering or UI ownership | [Data-Driven UI Inventory](docs/data-driven-ui.md#cross-cutting-trace-guides) |
| Classify generated, vendored, compatibility-only, or removed paths | [Generated Files And Legacy Caveats](docs/structure/generated-and-legacy.md) |
| Port an upstream RisuAI change into this fork | [Upstream Sync](docs/upstream-sync/README.md) and the current sweep ledger there |

## Repository Map

### Top-Level Paths

| Path | Purpose |
| ---- | ------- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Root package metadata, scripts, lockfile, and dependency-build policy; this is not a multi-package workspace. |
| `index.html`, `vite.config.ts`, `src/` | Svelte 5 SPA, Vite configuration, browser runtime, UI, language packs, and bundled client data. |
| `server/fastify/` | Fastify API and tests, including SQLite persistence and provider execution; it has no separate package manifest. |
| `STRUCTURE.md`, `docs/structure/`, `src/docs/` | Current architecture and implementation guides. Start at the [Architecture Index](docs/structure/README.md). |
| `docs/tests/`, `docs/data-driven-ui.md` | Current test-discovery and data-dependent UI inventories. |
| `docs/upstream-sync/` | Current fork-maintenance procedure and per-sweep ledger for upstream changes. |
| `.archived-docs/` | Closed workstreams and dated reports, including the message-generation parity audit. Do not infer current behavior from them. |
| `public/` | Static application sources copied or served by Vite, including the service worker and vendor/tokenizer payloads. |
| `resources/` | Retained packaging artwork; the current Vite/Fastify build does not consume it. |
| `util/` | Full-stack dev runners, database analyzer, tsserver wrapper, API-flag runner, and userscript bridge. |
| `scripts/` | Local helper-script area; currently empty. |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts` | TypeScript, Vitest, and Playwright configuration. |
| `.github/workflows/quality.yml` | Node 24 CI for pull requests and `main`; runs `pnpm test:all`. |
| `.claude/`, `.vscode/`, `.npmrc`, `.gitattributes`, `.gitignore`, `.ignore` | Agent tooling, editor, package-manager, Git, and search policy. |
| `.prettier*`, `README.md`, `version.json`, `LICENSE`, `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md` | Formatting policy, project metadata, and shared/local contributor and agent guidance. |
| `dist/`, `data/`, `data-agent/`, `node_modules/`, `coverage/`, `test-results/` | Generated or runtime state. Persisted/user-uploaded assets live under `data/assets/`; see [Generated And Legacy](docs/structure/generated-and-legacy.md). |

### Runtime Entrypoints

| Path | Responsibility |
| ---- | -------------- |
| `index.html` -> `src/main.ts` | Requests resize-content keyboard behavior, installs height-only visual-viewport/root-scroll coordination and optional viewport diagnostics, mounts the application, starts `loadData()`, and removes the preloader. |
| `src/App.svelte` | Svelte application shell, top-level render routing, overlays, and selected-character visibility guard. |
| `src/ts/bootstrap.ts` | Auth/writer bootstrap, recovery preparation, resource hydration/invalidation, plugin/runtime setup, and active-work reattachment. |
| `public/service-worker.js` | Web Push display, notification-click navigation, and client messaging. |
| `server/fastify/src/index.ts` | Loads configuration, builds the API, listens, and handles shutdown. |
| `server/fastify/src/app.ts` | Fastify composition root: plugins, SQLite, auth, writer policy, routes, jobs, workers, timers, and optional SPA. |

## Domain Ownership

The [cross-layer ownership map](docs/structure/domain-glossary.md#cross-layer-ownership)
lists the browser/UI and Fastify/storage owners for each domain. Use the
[cross-cutting change checklist](docs/structure/README.md#cross-cutting-changes)
to find companion files and tests.

## Repository-Wide Invariants

- The live application runtime is Fastify-only. Native-wrapper/mobile runtime
  modes, browser-local authoritative persistence, peer sync, Drive sync, and
  other non-Fastify modes are not live. Responsive mobile web UI remains
  supported. See [Generated Files And Legacy Caveats](docs/structure/generated-and-legacy.md).
- Fastify-owned SQLite rows, content-addressed asset bytes, and compatibility
  files are authoritative. The browser resource cache is disposable and
  hash-verified; the encrypted mutation outbox retains pending intent, while
  scoped recovery drafts retain editing state. None is an independent browser
  database or offline truth. See the [Cache Protocol](docs/structure/server-resources-and-bridges.md#cache-protocol).
- Normal revision-tracked domain writes use command mutations and global
  revision ordering. Server-owned exceptions are listed in
  [Data And Events](docs/structure/data-and-events.md#server-owned-exceptions).
- Persisted provider credentials are resolved server-side and masked before
  browser projections are hashed or returned. Typed provider/media operations
  may accept only their operation-specific one-shot drafts. Whole-database
  saves contain raw credentials and must be treated as secrets; the Settings
  ZIP-bundle export requires explicit secret-warning confirmation. See
  [Provider Credentials](docs/structure/providers-and-models.md#provider-credentials)
  and [Assets And Saves](docs/structure/assets-and-saves.md).
- Durable content must not be silently discarded. Whole-database imports reject
  unsupported group characters atomically; unsupported standalone CHAT blocks
  and oversized optional card assets are salvaged only with an exact completeness
  report; and generation finalization
  rejects a transcript target changed since assembly while retries preserve the
  same snapshot fence. See [Assets And Saves](docs/structure/assets-and-saves.md#character-cards)
  and [Generation And Background Work](docs/structure/backend.md#generation-and-background-work).
- Mutation-facing UI must distinguish `accepted`, `queued`, and `failed`. A
  queued mutation is retained intent, not server acceptance; preserve newer
  drafts and do not report success merely because dispatch began.
- Put new user-visible frontend strings in `src/lang`; `src/lang/en.ts` is the
  source language pack.
