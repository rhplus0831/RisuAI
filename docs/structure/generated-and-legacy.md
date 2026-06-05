# Generated Files And Legacy Caveats

These notes help avoid spending time in files that look important but are
generated, local-only, historical, or intentionally no-port.

## Do Not Hand-Edit As Source

| Path                                            | Why                                                                                                                                            |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `dist/`                                         | Vite build output. Regenerate with `pnpm build` or `pnpm buildsite`.                                                                           |
| `node_modules/`, `server/fastify/node_modules/` | Installed dependencies.                                                                                                                        |
| `test-results/`                                 | Playwright/test output.                                                                                                                        |
| `*.tsbuildinfo`                                 | TypeScript incremental build artifacts, including `tsconfig.client-lib.tsbuildinfo`.                                                           |
| `data/`                                         | Local runtime state: `risu.db`/WAL/SHM, assets, backups, auth, optional `data/dev`, legacy import artifacts. Useful for debugging, not source. |
| `scripts/` when present                         | Ignored local scratch/tooling directory.                                                                                                       |
| `public/token/`                                 | Vendor/tokenizer data. Only touch when intentionally updating those assets.                                                                    |
| `public/assets/`                                | Bundled Bergamot/browser translator workers. Only touch when intentionally updating vendor assets.                                             |
| `public/plugin_start.7z`                        | Packaged starter plugin archive.                                                                                                               |
| `src/ts/rpack/`                                 | Vendored rpack implementation; excluded from Prettier.                                                                                         |
| `src/ts/process/__fixtures__/expected/`         | Prompt/generation golden fixtures; regenerate with `UPDATE_FIXTURES=1`.                                                                        |
| `src/ts/process/__fixtures__/upstream/`         | Upstream fixture corpus for request/provider tests.                                                                                            |
| `*.snap` under test fixtures                    | Vitest snapshots; update through the relevant test workflow.                                                                                   |

`docs/archive/fastify/other/coverage/*.md` and other archive files are source
documentation, but they are historical. Prefer `STRUCTURE.md` and
`docs/structure/` for current behavior.

## Public Assets

`public/` is source for static assets copied by Vite. `dist/` is the generated
copy. Edit `public/` when changing a static source asset, then rebuild.

No tracked files live under `public/functions/`; in some workspaces the empty
directory may exist. Do not reintroduce old public worker/OAuth surfaces without
a new roadmap.

`tsconfig.json` still includes `public/sw.js`, but the service worker file is
absent and guarded by `src/ts/browserLocalSurface.test.ts`. Treat that include
as stale compatibility config, not active service-worker behavior.

## Fastify-Only Runtime

The project targets a Fastify-served web runtime. Historical mentions of native
wrappers, browser-local persistence as primary runtime, peer sync, Drive sync,
Risu Account Sync, and service-worker behavior are archival unless a new plan
reopens them.

Closed records under `docs/archive/` explain how the current runtime landed:
Fastify migration, client thinning, durable generation, lazy projection,
db-json-to-SQLite (`docs/archive/db-json-to-sqlite.md`), and protocol
stability/performance. They are design history, not always current guidance.

Current core systems that came from those workstreams:

- Server prompt assembly: `resolveServerPromptAssembly` plus
  `server/fastify/src/prompt/`.
- Durable generation: `server/fastify/src/generationJobs.ts`.
- SQLite-backed domain repository: `server/fastify/src/repository.ts` and
  `server/fastify/src/db.ts`.

## Legacy Names Still Active

Do not remove these just because the name sounds old:

- `server/fastify/src/routes/legacyStorage.ts` backs active `/api/v1/storage/*`
  compatibility routes used by `src/ts/storage/fastifyStorage.ts` and
  `src/ts/storage/autoStorage.ts`.
- `server/fastify/src/routes/hub.ts` backs retained hub passthrough behavior.
- Browser plugin runtime remains in `src/ts/plugins/`; server command routes
  store plugin records and plugin storage but do not execute plugin code.
- Server Lua scripting does execute during prompt assembly in
  `server/fastify/src/prompt/luaRuntime.ts`. Plugin V2 code execution remains
  unsupported on the server.

`data/db.json` is also a legacy name now. If present, `ensureDbJsonImported()`
imports it into SQLite and renames it to `db.json.migrated`; current runtime
state is not written back to live `db.json`.

## Stale Or No-Port Surfaces

- `src/LiteMain.svelte` is unwired. Live lite mode is `VITE_RISU_LITE` driving
  the mobile branch in `src/App.svelte`.
- `src/lib/UI/3DLoader.svelte` and `src/ts/3d/threeload.ts` are legacy and not
  imported by the current app shell.
- Old worktrees may contain `src/lib/UI/NewGUI/` or `src/ts/sync/`; both are
  absent from the current tree and should not be reintroduced as active UI/sync
  surfaces without a new plan.
- `src/lib/Others/WelcomeRisu.svelte` exists, but the current shell no longer
  imports it.

Removed or intentionally no-port concepts:

- Group chat.
- Peer sync and Google Drive sync.
- Risu Account Sync.
- Browser-local durable persistence as the primary runtime.
- Native/mobile wrapper runtime modes and service-worker behavior.
- SupaMemory, Hypa V2, and Hanurai as standalone maintained engines. Some legacy
  names remain in fields/classes used by the maintained Hypa V3 path.

Residual strings in bundled docs/localization can mention removed concepts. Treat
them as known cleanup follow-ups, not evidence of live support.
