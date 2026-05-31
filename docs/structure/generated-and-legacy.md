# Generated Files And Legacy Caveats

These notes help avoid spending time in files that look important but are either
generated, local-only, historical, or intentionally no-port.

## Do Not Hand-Edit

| Path                                            | Why                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `dist/`                                         | Vite build output, copied public assets, chunks, source maps, workers. Regenerate with `pnpm build` or `pnpm buildsite`. |
| `node_modules/`, `server/fastify/node_modules/` | Installed dependencies.                                                                                                  |
| `test-results/`                                 | Playwright/test output.                                                                                                  |
| `data/`                                         | Local runtime state: SQLite, `db.json`, assets, backups, auth files. Useful for manual debugging, not source.            |
| `scripts/`                                      | Ignored local scratch/tooling directory when present.                                                                    |
| `public/token/`                                 | Vendor/tokenizer data. Only touch when intentionally updating those assets.                                              |
| `public/assets/`                                | Bundled Bergamot/browser translator worker assets. Only touch when intentionally updating vendor assets.                 |
| `public/plugin_start.7z`                        | Packaged starter plugin archive.                                                                                         |
| `src/ts/rpack/`                                 | Vendored rpack implementation; also excluded from Prettier.                                                              |
| `src/ts/process/__fixtures__/expected/`         | Prompt/generation golden fixtures; regenerate only with `UPDATE_FIXTURES=1`.                                             |
| `src/ts/process/__fixtures__/upstream/`         | Upstream fixture corpus for request/provider tests.                                                                      |
| `*.snap` under test fixture directories         | Vitest snapshots; update through the relevant test workflow.                                                             |

`docs/archive/fastify/other/coverage/*.md` holds the test-coverage inventories;
treat those files as source documentation.

## Public Assets

`public/` is source for static assets copied by Vite. `dist/` is the generated
copy. Edit `public/` when changing a static source asset; rebuild to refresh
`dist/`.

`public/functions/` is currently absent after removed public worker/OAuth
surfaces. Do not reintroduce old Google Drive public workers without a new
explicit roadmap.

`tsconfig.json` still includes `public/sw.js`, but the service worker file is
absent and guarded by `src/ts/browserLocalSurface.test.ts`. Treat the include as a
stale compatibility include, not evidence that service-worker runtime behavior is
active.

## Fastify-Only Runtime

The project currently targets a Fastify-served web runtime. Historical mentions
of native wrappers, browser-side persistence as primary runtime, peer sync,
Drive sync, and service worker behavior are archival unless a new plan says
otherwise.

The archived phase scope docs under `docs/archive/fastify/phases/` are useful
for why decisions were made, but they are not always current implementation
guidance. Prefer the present-tense root [`../../STRUCTURE.md`](../../STRUCTURE.md)
and companion docs in `docs/structure/` for current state, and treat the
workstream records under `docs/archive/` (the Fastify migration,
`docs/archive/client-thinning/`, `docs/archive/durable-generation/`, and
`docs/archive/lazy-projection/`) as historical design/decision references.
Two large server-owned subsystems landed via those workstreams and are now core
runtime, not legacy: **server prompt assembly** (`resolveServerPromptAssembly` +
`server/fastify/src/prompt/`, with local assembly only outside Fastify mode) and
**durable generation** (`server/fastify/src/generationJobs.ts`; see backend.md).

`src/LiteMain.svelte` is currently an unwired legacy/lite shell. The real browser
entrypoint is `src/main.ts`, and the live lite mode is `VITE_RISU_LITE` driving
the mobile branch in `src/App.svelte`.

`src/lib/UI/3DLoader.svelte` and `src/ts/3d/threeload.ts` are explicitly marked
legacy and are not imported by the current app shell. `src/lib/UI/NewGUI/` and
`src/ts/sync/` are empty/stale-looking directories; do not infer active UI or
sync support from their presence.

`src/lib/Others/WelcomeRisu.svelte` still exists, but `src/App.svelte` no longer
imports it in the current shell.

## Legacy Names That Are Still Active

Some files retain legacy names because they bridge current behavior:

- `server/fastify/src/routes/legacyStorage.ts` backs active
  `/api/v1/storage/*` routes used by `src/ts/storage/nodeStorage.ts`.
- `server/fastify/src/routes/hub.ts` backs retained hub passthrough behavior.
- Browser plugin runtime remains in `src/ts/plugins/`; server command routes
  store plugin records and plugin storage but do not execute plugin code.
  Note the distinction: **Lua** scripting now _does_ execute server-side during
  prompt assembly (`server/fastify/src/prompt/luaRuntime.ts`), but **pluginV2** code
  execution stays permanently unsupported (no-port) — do not conflate the two.

Do not remove these just because the filename contains "legacy".

## Removed Or No-Port Areas

These are removed or intentionally not ported:

- Group chat.
- Peer sync.
- Google Drive sync.
- Risu Account Sync.
- SupaMemory, Hypa V2, and Hanurai as standalone maintained engines. Some legacy
  names remain in active Hypa V3 fields/classes; do not remove those by name alone.
- Native/mobile wrapper runtime modes.
- Browser local persistence as the primary supported runtime.

The maintained memory path is Hypa V3 on the Fastify server.

Residual group-chat strings and comments remain in some non-archive source and
bundled docs. They are known cleanup follow-ups tracked in
[`../leftover.md`](../leftover.md), not evidence of live group-chat support.
