# Project Structure

Last audited: 2026-08-02.

Use this file to orient yourself in the Fastify-only RisuAI codebase. The
supported toolchain is Node.js 24 or newer with pnpm. Choose the guide for your
task below; each guide is self-contained. [Archived documentation](.archived-docs/README.md)
records past decisions and is not authoritative.

## Choose By Task

| Task                                                                                  | Read next                                                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Locate unfamiliar code                                                               | [Architecture index](docs/structure/README.md) and [Domain Glossary](docs/structure/domain-glossary.md)                                                                        |
| Change Fastify composition, auth, routes, commands, workers, or Web Push             | [Backend Map](docs/structure/backend.md)                                                                                                                                       |
| Change SQLite, revisions, active-writer rules, command events, or streaming           | [Data And Events](docs/structure/data-and-events.md)                                                                                                                           |
| Change browser bootstrap, resources, hydration, invalidation, or durable mutations    | [Server Resources And Bridges](docs/structure/server-resources-and-bridges.md), then [Client Runtime Guide](src/docs/client-runtime.md)                                        |
| Change reload-durable composer or module-editor draft recovery                        | [Client Runtime Guide](src/docs/client-runtime.md#draft-recovery-stores), then [Svelte UI Guide](src/docs/svelte-ui.md)                                                        |
| Change Svelte UI, navigation, settings controls, chat, the floating composer, sidebars, or styling | [Svelte UI Guide](src/docs/svelte-ui.md)                                                                                                                         |
| Change Mood Light membership, session mode, character visibility, or route guards               | [Svelte UI Guide](src/docs/svelte-ui.md#sidebar-and-navigation-ui), [Client Runtime Guide](src/docs/client-runtime.md#mood-light-visibility-coordination), and [Server Resources And Bridges](docs/structure/server-resources-and-bridges.md#mood-light) |
| Change model profiles, credentials, providers, capabilities, or runtime options                  | [Providers And Models](docs/structure/providers-and-models.md)                                                                                                     |
| Change prompt assembly, CBS/history slots, input hooks, translation, Agents, or Agent Presets    | [Providers And Models](docs/structure/providers-and-models.md) and [Svelte UI Guide](src/docs/svelte-ui.md#agent-and-prompt-authoring)                              |
| Change LLM request history, provider metadata, or retention                           | [Providers And Models](docs/structure/providers-and-models.md), [Data And Events](docs/structure/data-and-events.md), and [Svelte UI Guide](src/docs/svelte-ui.md)             |
| Change modules, plugins, network permissions, or MCP                                  | [Plugins And MCP](docs/structure/plugins-and-mcp.md)                                                                                                                           |
| Change assets, the inlay catalog, character/CharX or chat exchange, post-export chat reset, backups, or Realm conversion | [Assets And Saves](docs/structure/assets-and-saves.md), then [Server Resources And Bridges](docs/structure/server-resources-and-bridges.md) for browser catalog reads |
| Run or extend checks, local dev, or CI                                                | [Testing And Operations](docs/structure/testing-and-operations.md) and the [Test Suite Guide](docs/tests/README.md)                                                            |
| Trace data-dependent rendering or UI ownership                                        | [Data-Driven UI Inventory](docs/data-driven-ui.md)                                                                                                                             |
| Classify generated, vendored, compatibility-only, or removed paths                    | [Generated Files And Legacy Caveats](docs/structure/generated-and-legacy.md)                                                                                                   |

## Repository Map

### Top-Level Paths

| Path                                                                           | Purpose                                                                                                                                        |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`                        | Root package metadata, scripts, lockfile, and dependency-build policy; this is not a multi-package workspace.                                 |
| `index.html`, `vite.config.ts`, `src/`                                         | Svelte 5 SPA, Vite configuration, browser runtime, UI, language packs, and bundled client data.                                                |
| `server/fastify/`                                                              | Fastify API and tests, including SQLite persistence and provider execution; it has no separate package manifest.                              |
| `STRUCTURE.md`, `docs/structure/`, `src/docs/`                                 | Current architecture and implementation guides. Start at the [Architecture Index](docs/structure/README.md).                                  |
| `docs/tests/`, `docs/data-driven-ui.md`                                        | Current test-discovery and data-dependent UI inventories.                                                                                      |
| `.archived-docs/`                                                              | Closed workstreams and dated reports. Do not infer current behavior from them.                                                                 |
| `public/`                                                                      | Static application sources copied or served by Vite, including the service worker and vendor/tokenizer payloads.                              |
| `resources/`                                                                   | Retained packaging artwork; the current Vite/Fastify build does not consume it.                                                                |
| `util/`                                                                        | Full-stack dev runners, database analyzer, tsserver wrapper, API-flag runner, and userscript bridge.                                           |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts`                               | TypeScript, Vitest, and Playwright configuration.                                                                                              |
| `.github/workflows/quality.yml`                                                | Node 24 CI for pull requests and `main`; runs `pnpm test:all`.                                                                                 |
| `.claude/`, `.vscode/`, `.npmrc`, `.gitattributes`, `.gitignore`, `.ignore`    | Agent tooling, editor, package-manager, Git, and search policy.                                                                                |
| `.prettier*`, `README.md`, `version.json`, `LICENSE`, `AGENTS.md`, `CLAUDE.md` | Formatting policy, project metadata, and contributor/agent guidance.                                                                           |
| `dist/`, `data/`, `data-agent/`, `node_modules/`, `coverage/`, `test-results/` | Generated or runtime state. Persisted/user-uploaded assets live under `data/assets/`; see [Generated And Legacy](docs/structure/generated-and-legacy.md). |

### Runtime Entrypoints

| Path                          | Responsibility                                                                                          |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `index.html` -> `src/main.ts` | Installs browser coordinators and mounts the application.                                               |
| `src/App.svelte`              | Svelte application shell, top-level render routing, and selected-character visibility guard.            |
| `src/ts/bootstrap.ts`         | Auth/writer bootstrap, recovery preparation, resource hydration, invalidation, and active-work recovery. |
| `server/fastify/src/index.ts` | Loads configuration, builds the API, listens, and handles shutdown.                                     |
| `server/fastify/src/app.ts`   | Fastify composition root: plugins, SQLite, auth, writer policy, routes, jobs, timers, and optional SPA. |

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
- SQLite is authoritative. The browser resource cache is disposable and
  hash-verified. The encrypted mutation outbox and scoped draft-recovery stores
  retain pending intent or editing state; neither is an independent application
  database. See [Server Resources And Bridges](docs/structure/server-resources-and-bridges.md).
- Mood Light is a browser privacy/visibility partition, not an authorization
  boundary. Its normalized membership is durable server-backed settings state;
  the active flag is tab-local `sessionStorage`, and Fastify continues to return
  all character rows.
- Normal revision-tracked domain writes use command mutations and global
  revision ordering. Server-owned exceptions are listed in
  [Data And Events](docs/structure/data-and-events.md#server-owned-exceptions).
- During normal runtime, persisted provider credentials are resolved server-side
  and resource projections mask their secrets. Whole-database exports can
  contain raw credentials and must be treated as secrets. Provider/media APIs
  expose fixed, validated operations rather than arbitrary upstream requests;
  permitted one-shot credential drafts are operation-specific.
- Mutation-facing UI must distinguish `accepted`, `queued`, and `failed`. A
  queued mutation is retained intent, not server acceptance; preserve newer
  drafts and do not report success merely because dispatch began.
- Put new user-visible frontend strings in `src/lang`; `src/lang/en.ts` is the
  source language pack.
