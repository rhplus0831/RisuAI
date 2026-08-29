# Project Structure

Last audited: 2026-08-29.

Use this file to orient yourself in the Fastify-only RisuAI codebase. The
supported toolchain is Node.js 24 or newer with pnpm. Choose the guide for your
task below; each guide is self-contained. [Archived documentation](.archived-docs/README.md)
records past decisions and is not authoritative.

Upstream synchronization uses
`f3f0242fba297d82e0efcc2c31ca1428569b70f2` as the behavioral sync cursor:
upstream changes through that commit were dispositioned and, where applicable,
ported into this fork's architecture. It is not the Git fork point or a
source-equivalent ancestor; compatibility work remains pinned to `71c476e9c`.

## Choose By Task

| Task area | Read next |
| --------- | --------- |
| Unfamiliar code or cross-layer ownership | [Architecture Index](docs/structure/README.md) and [Domain Glossary](docs/structure/domain-glossary.md#cross-layer-ownership) |
| Fastify composition, routes, generation operations/effects, jobs, timers, tracing, or Web Push | [Backend Map](docs/structure/backend.md) |
| SQLite, revisions, active writer, command events, or SSE | [Data And Events](docs/structure/data-and-events.md) |
| Browser resources, cache, or hydration | [Server Resources And Hydration](docs/structure/server-resources-and-bridges.md), then [Client Runtime](src/docs/client-runtime.md) |
| Durable mutations, command events, invalidation, bridges, writer loss, or recovery | [Durable Mutations And Recovery](docs/structure/durable-mutations-and-recovery.md) |
| Chat, transcript, message, composer, generation UI, drafts, viewport behavior, or completion audio | [Svelte Chat UI](src/docs/svelte-chat-ui.md), then [Generation Client](src/docs/generation-client.md) for durable generation |
| Sidebars, routes, chat lists, character selection, or reordering | [Svelte Navigation UI](src/docs/svelte-navigation-ui.md) |
| Settings, shared controls/accessibility, localization, authoring pages, or provider panels | [Svelte Settings UI](src/docs/svelte-settings-ui.md) and [Svelte UI](src/docs/svelte-ui.md#localization) |
| App shell, styling/themes, responsive/Lite behavior, Playground, or data-dependent rendering | [Svelte UI](src/docs/svelte-ui.md) |
| Model profiles, credentials, providers, capabilities, runtime options, or request history | [Providers And Models](docs/structure/providers-and-models.md) |
| Prompt assembly, templates, lorebook/Hypa/BardWiki memory, CBS, regex, triggers, or Lua | [Prompt Assembly And Scripting](docs/structure/prompt-assembly-and-scripting.md) and [BardWiki Memory](docs/structure/bardwiki.md) |
| BardWiki settings, documents, confirmation, jobs, prompt retrieval, vaults, rebuilds, or lifecycle | [BardWiki Memory](docs/structure/bardwiki.md) |
| Translation, translator presets/caches/jobs, or Draft/BTW input hooks | [Translation And Input Hooks](docs/structure/translation-and-input-hooks.md) |
| Agents, Agent Presets, prepared inputs, dependencies, or output composition | [Agents And Presets](docs/structure/agents-and-presets.md) |
| Modules, plugins, permissions, or MCP | [Plugins And MCP](docs/structure/plugins-and-mcp.md) |
| Assets, inlay catalog, `.risu`/CharX/chat exchange, backups, reset, or Realm conversion | [Assets And Saves](docs/structure/assets-and-saves.md) |
| Startup performance, bundle boundaries, observer rollout, or readiness budgets | [Development And Observability](docs/structure/development-and-observability.md#fast-bootstrap-measurement-and-rollout-gate), [Server Resources And Hydration](docs/structure/server-resources-and-bridges.md), and [Client Runtime](src/docs/client-runtime.md) |
| Tests, Node/Svelte+Node/DOM/browser capability routing, compatibility harness, CI, TypeScript, or formatting | [Testing And Operations](docs/structure/testing-and-operations.md) and [Test Suite Guide](docs/tests/README.md) |
| Local dev, tracing, startup telemetry, environment, or browser support | [Development And Observability](docs/structure/development-and-observability.md) |
| Generated, ignored, compatibility-only, or removed paths | [Generated And Legacy](docs/structure/generated-and-legacy.md) |

## Repository Map

### Top-Level Paths

| Path | Purpose |
| ---- | ------- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Root application metadata, scripts, lockfile, workspace membership, and dependency-build policy. |
| `packages/protocol/` | Browser-safe, schema-first wire contracts shared by the Svelte client and Fastify; it must not import application, Svelte, Fastify, database, or Node-only modules. |
| `index.html`, `vite.config.ts`, `src/` | Svelte 5 SPA, Vite configuration, browser runtime, UI, language packs, and bundled client data. |
| `server/fastify/` | Fastify API and tests, including SQLite persistence and provider execution; it has no separate package manifest. |
| `STRUCTURE.md`, `docs/structure/`, `src/docs/` | Current architecture and implementation guides. Start at the [Architecture Index](docs/structure/README.md). |
| `docs/plan/` | Active multi-phase workstreams, including live status, phase boundaries, and verification records. These plans do not supersede current runtime documentation until their phases land. |
| `docs/tests/` | Test-discovery guides organized by product and domain area. |
| `.archived-docs/` | Closed or retired workstreams and dated reports, including the test-suite effectiveness audit, Fast Bootstrap execution guide, August Fastify audits, upstream-sync sweep, data-driven UI inventory, and message-generation parity audit. Test-audit manifests and narrative records are historical. |
| `test/compat-harness/` | Opt-in golden compatibility comparison against the pinned pre-Fastify worktree; it is not part of `pnpm test:all`. |
| `public/` | Static application sources copied or served by Vite, including the service worker and vendor/tokenizer payloads. |
| `resources/` | Retained packaging artwork; the current Vite/Fastify build does not consume it. |
| `util/` | Full-stack dev runners, database analyzer, tsserver wrapper, API-flag runner, and userscript bridge. |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts` | TypeScript, Vitest, and Playwright configuration. |
| `.github/workflows/quality.yml` | Parallel Node 24 CI for pull requests and `main`; preserves local `test:all` ownership, always runs the focused UI coverage map once, and adds initial-preload reporting. |
| `.claude/`, `.vscode/`, `.npmrc`, `.gitattributes`, `.gitignore`, `.ignore` | Agent tooling, editor, package-manager, Git, and search policy. |
| `.prettier*`, `README.md`, `version.json`, `LICENSE`, `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md` | Formatting policy, project metadata, and shared/local contributor and agent guidance. |
| `dist/`, `data/`, `data-agent/`, `node_modules/`, `coverage/`, `test-results/`, `fast-bootstrap-results/` | Generated or runtime state. Persisted/user-uploaded assets live under `data/assets/`; see [Generated And Legacy](docs/structure/generated-and-legacy.md). |

### Runtime Entrypoints

| Path | Responsibility |
| ---- | -------------- |
| `index.html` | Declares the app mount/preloader, loads `src/main.ts`, and requests `interactive-widget=resizes-content`. |
| `src/main.ts` | Thin browser entry boundary: records entry readiness, installs the runtime environment, handles preload failures, and dynamically imports `src/appStartup.ts`. |
| `src/appStartup.ts` | Installs routing, push listeners, viewport coordination, root-scroll protection, and completion-audio unlocking; mounts the app, starts bootstrap/hotkeys and route warming, and removes the preloader. |
| `src/App.svelte` | Svelte application shell, top-level render routing, overlays, and selected-character visibility guard. |
| `src/ts/bootstrap.ts` | Auth/writer bootstrap, recovery preparation, resource hydration/invalidation, plugin/runtime setup, and active-work reattachment. |
| `src/ts/startupReadiness.ts` | Monotonic startup milestones, narrow render/route/mutation/plugin/generation capabilities, retry diagnostics, and privacy-safe measurement events. |
| `public/service-worker.js` | Web Push display, notification-click navigation, and client messaging. |
| `server/fastify/src/index.ts` | Loads configuration, builds the API, listens, and handles shutdown. |
| `server/fastify/src/app.ts` | Fastify composition root: plugins, SQLite, auth, writer policy, routes, jobs, workers, timers, and optional SPA. |

## Domain Ownership

The [cross-layer ownership map](docs/structure/domain-glossary.md#cross-layer-ownership)
lists the browser/UI and Fastify/storage owners for each domain. Use the
[cross-cutting change checklist](docs/structure/README.md#cross-cutting-changes)
to find companion files and tests.

## Repository-Wide Invariants

- The live runtime is Fastify-only; responsive mobile web remains supported.
  Native wrappers, browser-local authoritative persistence, peer sync, and Drive
  sync are not live. See [Generated And Legacy](docs/structure/generated-and-legacy.md).
- Fastify SQLite rows, content-addressed assets, and compatibility files are
  authoritative. Browser caches are disposable; the encrypted outbox and scoped
  drafts retain pending intent or edits, not an independent offline database.
  See the [Cache Protocol](docs/structure/server-resources-and-bridges.md#cache-protocol).
- Normal revision-tracked domain writes use command mutations and global
  revision ordering. Server-owned exceptions are listed in
  [Data And Events](docs/structure/data-and-events.md#server-owned-exceptions).
- Mutation-facing UI must distinguish `accepted`, `queued`, and `failed`. A
  queued mutation is retained intent, not server acceptance; preserve newer
  drafts and do not report success merely because dispatch began.
- Put new user-visible frontend strings in `src/lang`; `src/lang/en.ts` is the
  source language pack.
- Unless there is an explicit instruction to change the architecture, we should continue to follow the single-writer rule for now. The single-writer rule exists to reduce implementation complexity, so new features do not need to account for multi-writer scenarios.
