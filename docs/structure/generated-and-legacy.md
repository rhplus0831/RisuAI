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
| `public/token/`                                 | Vendor/tokenizer data. Only touch when intentionally updating those assets.                                              |
| `src/ts/rpack/`                                 | Vendored rpack implementation; also excluded from Prettier.                                                              |

`docs/archive/fastify/other/coverage/*.md` holds the test-coverage inventories;
treat those files as source documentation.

## Public Assets

`public/` is source for static assets copied by Vite. `dist/` is the generated
copy. Edit `public/` when changing a static source asset; rebuild to refresh
`dist/`.

`public/functions/` is intentionally empty after removed public worker/OAuth
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
guidance. Prefer the present-tense docs in this `docs/structure/` folder and
the active client-thinning docs in `docs/client-thinning/`. Treat
`docs/archive/fastify/other/architecture.md` and
`docs/archive/fastify/client-thinning/` as historical references.

## Legacy Names That Are Still Active

Some files retain legacy names because they bridge current behavior:

- `server/fastify/src/routes/legacyStorage.ts` backs active
  `/api/v1/storage/*` routes used by `src/ts/storage/nodeStorage.ts`.
- `server/fastify/src/routes/hub.ts` backs retained hub passthrough behavior.
- Browser plugin runtime remains in `src/ts/plugins/`; server command routes
  store plugin records and plugin storage but do not execute plugin code.

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
