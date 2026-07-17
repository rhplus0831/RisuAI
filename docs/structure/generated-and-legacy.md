# Generated Files And Legacy Caveats

Last audited: 2026-07-17.

These notes help avoid spending time in files that look important but are
generated, local-only, historical, vendored, or intentionally no-port.

## Do Not Hand-Edit As Source

| Path                                            | Why                                                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dist/`                                         | Vite build output plus client-lib declarations under `dist/client-types`. Regenerate with `pnpm build`/`pnpm build:site` or the client-lib `tsc` step. |
| `node_modules/`, `server/fastify/node_modules/` | Installed dependencies.                                                                                                                                |
| `coverage/`                                     | Local coverage reports from frontend/backend/UI coverage scripts.                                                                                       |
| `test-results/`                                 | Playwright/test output.                                                                                                                                |
| `blobs-for-test/`                               | Ignored local binary/test scratch payloads.                                                                                                             |
| `*.tsbuildinfo`                                 | TypeScript incremental build artifacts, including `tsconfig.client-lib.tsbuildinfo`.                                                                   |
| `data/`                                         | Local runtime state: `risu.db`/WAL/SHM, assets, backups, auth files, optional Web Push VAPID keys, `data/save/`, request/generation body sidecars and optional tsserver logs under `data/trace/`, optional `data/dev`, legacy import artifacts. Useful for debugging, not source; see `data-and-events.md`. |
| `scripts/` when present                         | Ignored local scratch/tooling directory.                                                                                                               |
| `public/token/`                                 | Vendor/tokenizer data. Only touch when intentionally updating those assets.                                                                            |
| `public/assets/`                                | Bundled Bergamot/browser translator workers. Only touch when intentionally updating vendor assets.                                                     |
| `public/plugin_start.7z`                        | Packaged starter plugin archive.                                                                                                                       |
| `src/etc/docs/`, `src/etc/o200k_base.json`      | Bundled/static documentation and tokenizer payloads; treat as static payloads unless intentionally updating them.                                       |
| `src/ts/rpack/`                                 | Vendored rpack implementation; excluded from Prettier.                                                                                                 |
| `src/ts/process/__fixtures__/expected/`         | Prompt/generation golden fixtures; regenerate with `UPDATE_FIXTURES=1`.                                                                                |
| `src/ts/process/__fixtures__/upstream/`         | Upstream fixture corpus for request/provider tests.                                                                                                    |
| `*.snap` under test fixtures                    | Vitest snapshots; update through the relevant test workflow.                                                                                           |
| `server/fastify/browser-smoke/*-snapshots/*.png` | Tracked Playwright visual baselines, not scratch output. Update only for an intentional visible change through the smoke workflow.                    |

`.archived-docs/` files are historical documentation. They may contain
present-tense statements, commands, and gate references that were true at
closeout and are now stale. Prefer `STRUCTURE.md`, `docs/structure/`, code, and
the current behavioral tests. None of the archived audit Markdown is a live
test fixture.

`docs/structure/frontend.md` is source documentation only as a compatibility
pointer for older links. Add current frontend guidance to
`src/docs/svelte-ui.md` or `src/docs/client-runtime.md`.

Other ignored paths fall into four groups: retired build/runtime trees, local
environment and editor state, logs/caches, and agent scratch files. Treat them
as non-source unless a new plan explicitly reopens one. `.gitignore` is the
source of truth for the exact list; `.ignore` is the source of truth for broad
search exclusions.

Prettier also skips Markdown/docs/handoff docs, `pnpm-lock.yaml`,
tracked static/vendor payloads, media/binary assets, and generated/local
directories listed in `.prettierignore` or `.gitignore`. Broad file/text
searches also skip tracked static/vendor payloads listed in `.ignore`; use
`--no-ignore` only when intentionally inspecting those assets. `pnpm format` will
not tidy structure docs, so preserve table wrapping manually.

## Static Assets

`public/` is source for static assets copied by Vite. `dist/` is the generated
copy. Edit `public/` when changing a static source asset, then rebuild.

`resources/` contains app icon/splash source images such as `icon-*.png` and
`splash*.png`. It is not copied by Vite unless a packaging step consumes it.

`src/etc/` contains bundled imported media/docs/tokenizer seed data. Keep these
static app assets separate from Fastify runtime assets, which are addressed by
server asset ids and stored under `data/assets/`.

No tracked files live under `public/functions/`; in some workspaces the empty
directory may exist. Do not reintroduce old public worker/OAuth surfaces without
a new roadmap.

`tsconfig.json` includes `public/service-worker.js`. That worker is active only
for Web Push chat-completion notifications through
`src/ts/server/pushNotifications.ts`. Legacy `public/sw.js`
share/file-handler/offline service-worker surfaces remain absent and guarded by
`src/ts/browserLocalSurface.test.ts`.

## Fastify-Only Runtime

The project targets a Fastify-served web runtime. Historical mentions of native
wrappers, browser-local persistence as primary runtime, peer sync, Drive sync,
Risu Account Sync, and legacy `public/sw.js` share/file-handler/offline
service-worker behavior are archival unless a new plan reopens them.

Closed records under `.archived-docs/` explain how the current runtime landed:
Fastify migration, client thinning, durable generation, the former lazy
projection architecture and its replacement by concrete REST resources,
db-json-to-SQLite
(`.archived-docs/protocol-and-persistence/sqlite-migration.md`), and the v1-v4
stability/performance audits under
`.archived-docs/performance-and-stability/stability-audits/`. They are design
history, not current guidance.

Current core systems that came from those workstreams:

- Server prompt assembly: `resolveServerPromptAssembly()` plus
  `server/fastify/src/prompt/`.
- Durable generation: `server/fastify/src/generationJobs.ts`.
- SQLite-backed domain repository: `server/fastify/src/repository.ts` and
  `server/fastify/src/db.ts`.
- API-backed browser resources: `server/fastify/src/routes/resourceReads.ts`
  plus `src/ts/server/resourceState.svelte.ts` and
  `src/ts/server/resourceInvalidation.ts`.

## Legacy Names Still Active

Do not remove these just because the name sounds old:

- `server/fastify/src/routes/legacyStorage.ts` backs active `/api/v1/storage/*`
  compatibility routes used by `src/ts/storage/fastifyStorage.ts` and
  `src/ts/storage/autoStorage.ts`.
- `server/fastify/src/routes/hub.ts` backs retained hub passthrough behavior.
- Browser plugin runtime remains in `src/ts/plugins/`; server command routes
  store plugin records and plugin storage but do not execute plugin code.
- Server Lua scripting executes during prompt assembly in
  `server/fastify/src/prompt/luaRuntime.ts`. Plugin V2 code execution remains
  unsupported on the server.

`data/db.json` is also a legacy name now. If present, `ensureDbJsonImported()`
imports it into SQLite and renames it to `db.json.migrated`; current runtime
state is not written back to live `db.json`.

Old UI strings may still mention `save/__password` or `save/__password.txt`.
Fastify auth state actually lives under `data/__password`,
`data/__known_public_key_hashes.json`, and
`data/__known_session_token_hashes.json`.

## Stale Or No-Port Surfaces

- `src/LiteMain.svelte` is unwired. Live lite mode is `VITE_RISU_LITE` driving
  `src/ts/lite.ts` plus consumers such as settings, color scheme, and legacy
  mobile component branches; it does not re-enable `LiteMain.svelte`.
- `src/lib/Mobile/MobileCharacters.svelte` is active through `GridCatalog`.
  `MobileHeader.svelte`, `MobileBody.svelte`, and `MobileFooter.svelte` are the
  unmounted legacy mobile shell.
- `src/lib/UI/3DLoader.svelte` and `src/ts/3d/threeload.ts` are legacy and not
  imported by the current app shell.
- Picture-in-picture session keepalive is retired. Current settings support
  only `off` and `sound`; imported legacy `pip` values normalize to `sound`.
- Old worktrees may contain `src/lib/UI/NewGUI/` or `src/ts/sync/`; both are
  absent from the current tree and should not be reintroduced as active UI/sync
  surfaces without a new plan.
- `src/lib/Others/WelcomeRisu.svelte` is retained and tested onboarding/setup
  UI, but the current shell no longer imports it.

Removed or intentionally no-port concepts: group chat, peer sync, Google Drive
sync, Risu Account Sync, browser-local durable persistence as the primary
runtime, native/mobile wrapper runtime modes, legacy `public/sw.js`
share/file-handler/offline service-worker behavior, and standalone
SupaMemory/Hypa V2/Hanurai engines. `HypaProcessorV2` remains an active helper
inside maintained Hypa V3 logic, and `supaMemory` field/key/memo names remain
active compatibility names for that maintained path.
