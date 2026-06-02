# Structure Notes

Last explored: 2026-06-01.

This is the present-tense navigation map for the codebase. It is the companion
to the focused notes in [`docs/structure/`](docs/structure/) and to the
**archived** workstream records in [`docs/archive/`](docs/archive/README.md).
Use it to find the right part of the codebase quickly before making a change,
and use [`docs/leftover.md`](docs/leftover.md) for still-open follow-ups.

## Read Order

1. [`STRUCTURE.md`](STRUCTURE.md) - repo map and standing conventions.
2. [`docs/structure/backend.md`](docs/structure/backend.md) - Fastify app,
   routes, generation, memory.
3. [`docs/structure/frontend.md`](docs/structure/frontend.md) - Svelte
   entrypoints, UI directories, server projection flow.
4. [`docs/structure/server-projection-and-bridges.md`](docs/structure/server-projection-and-bridges.md) -
   browser projection, hydration, event reconcile, and bridge watchers.
5. [`docs/structure/data-and-events.md`](docs/structure/data-and-events.md) -
   persistence split, auth, revisions, SSE.
6. [`docs/structure/assets-and-saves.md`](docs/structure/assets-and-saves.md) -
   content-addressed assets, asset GC, `.risu` import/export, backups.
7. [`docs/structure/plugins-and-mcp.md`](docs/structure/plugins-and-mcp.md) -
   browser plugin runtime, plugin storage, MCP clients, and tool limits.
8. [`docs/structure/providers-and-models.md`](docs/structure/providers-and-models.md) -
   model registry, provider dispatch, capability routing, and secrets.
9. [`docs/structure/domain-glossary.md`](docs/structure/domain-glossary.md) -
   common Risu domain terms and where they live.
10. [`docs/structure/testing-and-operations.md`](docs/structure/testing-and-operations.md) -
    scripts, test split, env, Docker.
11. [`docs/structure/generated-and-legacy.md`](docs/structure/generated-and-legacy.md) -
    generated files and removed/no-port surfaces.

For workstream history and decision records, start with
[`docs/archive/README.md`](docs/archive/README.md): the Fastify migration
([`docs/archive/fastify/`](docs/archive/fastify/README.md)), the
client-thinning server-projection workstream
([`docs/archive/client-thinning/`](docs/archive/client-thinning/README.md)),
durable generation
([`docs/archive/durable-generation/`](docs/archive/durable-generation/README.md)),
and lazy projection
([`docs/archive/lazy-projection/`](docs/archive/lazy-projection/README.md)),
plus the server/client protocol stability and performance closeout
([`docs/archive/server-client-protocol-stability-performance/`](docs/archive/server-client-protocol-stability-performance/README.md)).
These workstreams are closed; the archives hold the consolidated invariant
contracts, phase scope docs, and design references.

## Top-Level Map

| Path                                                                                 | Purpose                                                                                                              |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`                              | pnpm scripts, dependencies, install policy, and the locked dependency graph.                                         |
| `index.html`, `vite.config.ts`, `src/`                                               | Svelte 5 browser app and Vite build/dev configuration.                                                               |
| `src/etc/`                                                                           | Bundled app media, CBS docs, patch notes, and tokenizer seed data imported by the client.                            |
| `server/fastify/`                                                                    | Fastify API, persistence, prompt assembly, generation, memory, server tests, browser smoke.                          |
| `public/`                                                                            | Static source assets copied by Vite; `public/token/` is vendor tokenizer data.                                       |
| `resources/`                                                                         | App icon and splash image resources.                                                                                 |
| `tsconfig*.json`, `vitest*.ts`, `playwright*.ts`                                     | TypeScript, Vitest, and Playwright configuration.                                                                    |
| `.prettierrc.json`, `.prettierignore`                                                | Prettier formatting policy.                                                                                          |
| `util/client-thinning-audit.ts`, `util/client-thinning-audit.test.ts`                | ts-morph architecture invariant audit and its regression tests.                                                      |
| `util/client-thinning-audit-fixtures/`                                               | Fixture corpus for the architecture audit; source-like test data, not runtime code.                                  |
| `util/risuUserscript.user.js`                                                        | Risu userscript bridge exposing `GM_fetch` for cross-origin browser requests.                                        |
| `Dockerfile`, `docker-compose.yml`                                                   | Container build/run path.                                                                                            |
| `README.md`, `plugins.md`, `version.json`, `LICENSE`                                 | Project-facing docs, plugin notes, packaged version metadata, and license.                                           |
| `AGENTS.md`, `CLAUDE.md`, `HANDOVER.md`                                              | Local agent/handoff instructions and context.                                                                        |
| `.github/`, `.vscode/`, `.npmrc`, `.gitattributes`, `.gitignore`, `.dockerignore`    | Repository automation, editor recommendations, install policy, merge attributes, and ignore/container rules.         |
| `docs/structure/`                                                                    | Focused present-tense structure notes.                                                                               |
| `docs/FASTIFY-REPORT.md`, `docs/SERVER-AND-CLIENT*.md`                               | Dated Fastify ownership, responsibility, and protocol audit reports.                                                 |
| `docs/server-client-protocol-stability-performance/`                                 | Compatibility entry for the archived protocol stability/performance workstream; points to the archive and leftovers. |
| `docs/leftover.md`                                                                   | Live tracker of intentionally-deferred items across the closed workstreams.                                          |
| `docs/archive/`                                                                      | Closed workstream records: Fastify, client thinning, durable generation, lazy projection, and protocol stability.    |
| `dist/`, `data/`, `node_modules/`, `test-results/`, `scripts/`, `.idea/`, `.claude/` | Generated, installed, ignored scratch, local runtime/test output, or local editor/agent state; do not hand-edit.     |

## Runtime Entrypoints

| Path                                    | Purpose                                                                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/fastify/src/index.ts`           | API process entrypoint; builds the app and listens.                                                                                                                          |
| `server/fastify/src/app.ts`             | Fastify app factory, plugin setup, lifecycle hooks, route registration, static SPA serving.                                                                                  |
| `server/fastify/src/routes/`            | Server route registrars for `/api/v1/*`.                                                                                                                                     |
| `server/fastify/src/commands/`          | Validators and mutation helpers for command-backed domain resources.                                                                                                         |
| `server/fastify/src/db.ts`              | SQLite schema/migrations, schema version, global revision, and command-event history table setup.                                                                            |
| `server/fastify/src/repository.ts`      | `db.json` repository boundary, asset metadata, backups/imports/restores, and chat message join/split helpers.                                                                |
| `server/fastify/src/routeManifest.ts`   | Route auth/protocol inventory used by active-writer guard, tests, and the architecture audit.                                                                                |
| `server/fastify/src/activeWriter.ts`    | Server-side single-writer lease guard for server-owned mutations.                                                                                                            |
| `server/fastify/src/protocolMetrics.ts` | Opt-in server protocol metrics behind `RISU_PROTOCOL_METRICS`.                                                                                                               |
| `server/fastify/src/generation/`        | Provider-specific generation adapters and shared SSE/frame helpers used by chat and completion dispatch.                                                                     |
| `server/fastify/src/prompt/`            | Server prompt assembly, tokenizer config, Lua VM, provider transport, post-generation pass.                                                                                  |
| `server/fastify/src/risuSave/`          | `.risu` import/export codecs, bundle export, and asset-reference reporting.                                                                                                  |
| `server/fastify/src/messageStore.ts`    | SQLite chat message, per-chat `hypaV3Data`, and reroll-alternate storage boundary.                                                                                           |
| `server/fastify/src/generationJobs.ts`  | Detached, reattachable chat-generation job registry.                                                                                                                         |
| `server/fastify/src/memory*.ts`         | Hypa V3 memory tables, planning, selection/ranking, job handlers, events, and worker.                                                                                        |
| `src/main.ts`                           | Browser SPA bootstrap.                                                                                                                                                       |
| `src/App.svelte`                        | Main Svelte shell and top-level render switch.                                                                                                                               |
| `src/lib/`                              | Svelte component directories.                                                                                                                                                |
| `src/ts/server/`                        | Browser-side Fastify adapters for bootstrap, commands, projection/hydration, assets, events, backups, active-writer headers, Realm import, smoke hooks, and bridge watchers. |
| `src/ts/server/protocolDiagnostics.ts`  | Browser-side protocol, resync, and hydration diagnostics.                                                                                                                    |
| `src/ts/process/`                       | `sendChat`, server/local request routing, local dispatch, MCP/files, prompt helpers, memory/PDF/embedding helpers, post-generation, reattach.                                |
| `src/ts/storage/`                       | Client projection state, server-backed storage auth, `.risu` import/export helpers.                                                                                          |

## Standing Conventions

- Use `pnpm`; the project lockfile is `pnpm-lock.yaml`.
- Node.js 24+ is required.
- Fastify is the only runtime. `isFastifyServer` is unconditionally `true`;
  there are no platform-selection flags or non-Fastify code paths. Old
  native/mobile wrappers, browser-side persistence modes, service worker
  behavior, peer sync, Drive sync, and removed memory engines are not targets
  for new work.
- There are no Fastify compatibility migrations for legacy web/runtime modes.
  SQLite schema migrations do exist in `server/fastify/src/db.ts`; keep that
  distinction clear when changing persisted server data.
- New Fastify routes should be registered from `buildApp()` in
  `server/fastify/src/app.ts` and should call `requireAuth()` explicitly unless
  the route is intentionally public.
- New API routes need a route/protocol manifest decision in
  `server/fastify/src/routeManifest.ts`; active-writer classification, route
  protection tests, and the architecture audit all read from that manifest.
- Revision-tracked `data/db.json` mutations should go through the command
  mutation path so `baseRevision`, revision bumps, and command events stay in
  sync. Explicit server-owned mutation routes include import/restore, asset
  upload, generation, and memory job creation/cancel.
- Server-side prompt assembly is the only chat-send path: a supported send is
  classified by `resolveServerPromptAssembly` plus the shared
  `resolveProviderCapability` table and routed to the server assembler;
  unsupported shapes hard-fail.
- Root TypeScript is intentionally loose for browser code; `server/fastify` has
  its own strict TypeScript config.
