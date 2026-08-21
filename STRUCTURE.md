# Project Structure

Last audited: 2026-08-21.

Use this file to orient yourself in the Fastify-only RisuAI codebase. The
supported toolchain is Node.js 24 or newer with pnpm. Choose the guide for your
task below; each guide is self-contained. [Archived documentation](.archived-docs/README.md)
records past decisions and is not authoritative.

## Choose By Task

| Task area | Read next |
| --------- | --------- |
| Unfamiliar code or cross-layer ownership | [Architecture Index](docs/structure/README.md) and [Domain Glossary](docs/structure/domain-glossary.md#cross-layer-ownership) |
| Fastify composition, routes, generation operations/effects, jobs, timers, tracing, or Web Push | [Backend Map](docs/structure/backend.md) |
| SQLite, revisions, active writer, command events, or SSE | [Data And Events](docs/structure/data-and-events.md) |
| Browser resources, hydration, cache/invalidation, bridges, durable mutations, or recovery | [Server Resources And Bridges](docs/structure/server-resources-and-bridges.md), then [Client Runtime](src/docs/client-runtime.md) |
| Chat, transcript, message, composer, generation UI, drafts, viewport behavior, or completion audio | [Svelte Chat UI](src/docs/svelte-chat-ui.md), then [Client Runtime](src/docs/client-runtime.md#generation-client) for durable generation |
| Sidebars, routes, chat lists, character selection, or reordering | [Svelte Navigation UI](src/docs/svelte-navigation-ui.md) |
| Settings, shared controls/accessibility, localization, authoring pages, or provider panels | [Svelte Settings UI](src/docs/svelte-settings-ui.md) and [Svelte UI](src/docs/svelte-ui.md#localization) |
| App shell, styling/themes, responsive/Lite behavior, Playground, or data-dependent rendering | [Svelte UI](src/docs/svelte-ui.md) and [Data-Driven UI Inventory](docs/data-driven-ui.md) |
| Model profiles, credentials, providers, capabilities, runtime options, or request history | [Providers And Models](docs/structure/providers-and-models.md) |
| Prompt assembly, templates, lorebook/Hypa memory, CBS, regex, triggers, or Lua | [Prompt Assembly And Scripting](docs/structure/prompt-assembly-and-scripting.md) |
| Translation, translator presets/caches/jobs, or Draft/BTW input hooks | [Translation And Input Hooks](docs/structure/translation-and-input-hooks.md) |
| Agents, Agent Presets, prepared inputs, dependencies, or output composition | [Agents And Presets](docs/structure/agents-and-presets.md) |
| Modules, plugins, permissions, or MCP | [Plugins And MCP](docs/structure/plugins-and-mcp.md) |
| Assets, inlay catalog, `.risu`/CharX/chat exchange, backups, reset, or Realm conversion | [Assets And Saves](docs/structure/assets-and-saves.md) |
| Tests, compatibility harness, local dev, CI, generated paths, or removed paths | [Testing And Operations](docs/structure/testing-and-operations.md), [Test Suite Guide](docs/tests/README.md), and [Generated And Legacy](docs/structure/generated-and-legacy.md) |
| Upstream fork maintenance | [Upstream Sync](docs/upstream-sync/README.md) and its current sweep ledger |

## Repository Map

### Top-Level Paths

| Path | Purpose |
| ---- | ------- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | Root package metadata, scripts, lockfile, and dependency-build policy; this is not a multi-package workspace. |
| `index.html`, `vite.config.ts`, `src/` | Svelte 5 SPA, Vite configuration, browser runtime, UI, language packs, and bundled client data. |
| `server/fastify/` | Fastify API and tests, including SQLite persistence and provider execution; it has no separate package manifest. |
| `STRUCTURE.md`, `docs/structure/`, `src/docs/` | Current architecture and implementation guides. Start at the [Architecture Index](docs/structure/README.md). |
| `docs/tests/`, `docs/data-driven-ui.md`, `docs/upstream-sync/` | Test discovery, data-dependent UI, and fork-maintenance guides. |
| `.archived-docs/` | Closed workstreams and dated reports, including the message-generation parity audit. Do not infer current behavior from them. |
| `test/compat-harness/` | Opt-in golden compatibility comparison against the pinned pre-Fastify worktree; it is not part of `pnpm test:all`. |
| `public/` | Static application sources copied or served by Vite, including the service worker and vendor/tokenizer payloads. |
| `resources/` | Retained packaging artwork; the current Vite/Fastify build does not consume it. |
| `util/` | Full-stack dev runners, database analyzer, tsserver wrapper, API-flag runner, and userscript bridge. |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts` | TypeScript, Vitest, and Playwright configuration. |
| `.github/workflows/quality.yml` | Node 24 CI for pull requests and `main`; runs `pnpm test:all`. |
| `.claude/`, `.vscode/`, `.npmrc`, `.gitattributes`, `.gitignore`, `.ignore` | Agent tooling, editor, package-manager, Git, and search policy. |
| `.prettier*`, `README.md`, `version.json`, `LICENSE`, `AGENTS.md`, `AGENTS.override.md`, `CLAUDE.md` | Formatting policy, project metadata, and shared/local contributor and agent guidance. |
| `dist/`, `data/`, `data-agent/`, `node_modules/`, `coverage/`, `test-results/` | Generated or runtime state. Persisted/user-uploaded assets live under `data/assets/`; see [Generated And Legacy](docs/structure/generated-and-legacy.md). |

### Runtime Entrypoints

| Path | Responsibility |
| ---- | -------------- |
| `index.html` | Declares the app mount/preloader, loads `src/main.ts`, and requests `interactive-widget=resizes-content`. |
| `src/main.ts` | Installs routing, push listeners, viewport coordination, root-scroll protection, and shared completion-audio context unlocking; mounts the app, starts bootstrap/hotkeys, and removes the preloader. |
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

- The live runtime is Fastify-only; responsive mobile web remains supported.
  Native wrappers, browser-local authoritative persistence, peer sync, and Drive
  sync are not live. See [Generated And Legacy](docs/structure/generated-and-legacy.md).
- Fastify SQLite rows, content-addressed assets, and compatibility files are
  authoritative. Browser caches are disposable; the encrypted outbox and scoped
  drafts retain pending intent or edits, not an independent offline database.
  See the [Cache Protocol](docs/structure/server-resources-and-bridges.md#cache-protocol).
- Intermediate `editdisplay` processing is Fastify-owned for negotiated,
  parity-supported chat rows, while final Markdown/sanitization/DOM work remains
  browser-owned. Derived `displaySource` text is process-local and never message
  authority; see
  [Intermediate Display Processing](docs/structure/prompt-assembly-and-scripting.md#intermediate-display-processing).
- Normal revision-tracked domain writes use command mutations and global
  revision ordering. Server-owned exceptions are listed in
  [Data And Events](docs/structure/data-and-events.md#server-owned-exceptions).
- Persisted credentials are resolved server-side and masked in browser
  projections. Only typed operations may accept one-shot drafts. Whole-database
  saves contain raw credentials and must be treated as secrets. See
  [Provider Credentials](docs/structure/providers-and-models.md#provider-credentials)
  and [Assets And Saves](docs/structure/assets-and-saves.md).
- Durable content must not be silently discarded. Imports either reject
  unsupported content atomically or report exact salvage, and generation
  finalization fences the assembly-time transcript snapshot. See
  [Assets And Saves](docs/structure/assets-and-saves.md#character-cards)
  and [Generation And Background Work](docs/structure/backend.md#generation-and-background-work).
- Mutation-facing UI must distinguish `accepted`, `queued`, and `failed`. A
  queued mutation is retained intent, not server acceptance; preserve newer
  drafts and do not report success merely because dispatch began.
- Put new user-visible frontend strings in `src/lang`; `src/lang/en.ts` is the
  source language pack.
