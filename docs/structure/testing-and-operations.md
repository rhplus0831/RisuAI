# Testing And Operations

Use `pnpm` for package scripts. Node.js is declared as `>=24.0.0`. The package
is root-only; there is no `server/fastify/package.json`.

## Scripts

| Command                            | Purpose                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                         | Start Vite client dev server on `0.0.0.0:5174`.                                                               |
| `pnpm api:dev`                     | Start Fastify with `tsx watch server/fastify/src/index.ts`.                                                   |
| `pnpm api:dev:flag`                | Start Fastify through `util/api-flag-dev.ts`; restarts only when `.risu-api-restart` is touched/created.      |
| `pnpm api:start`                   | Start Fastify once with `tsx server/fastify/src/index.ts`.                                                    |
| `pnpm build`                       | Vite build with sourcemaps.                                                                                   |
| `pnpm buildsite`                   | Production client build with `VITE_RISU_LEGAL_CONFIGURED=TRUE`.                                               |
| `pnpm preview`                     | Vite preview server for a built client bundle.                                                                |
| `pnpm check`                       | Run `svelte-check --tsconfig ./tsconfig.json`.                                                                |
| `pnpm test`                        | Run root/browser Vitest tests.                                                                                |
| `pnpm api:test`                    | Run Fastify/server Vitest tests.                                                                              |
| `pnpm smoke:fastify-browser`       | Build site, then run Playwright Fastify browser smoke.                                                        |
| `pnpm client-thinning:audit`       | Run `util/client-thinning-audit.ts`.                                                                          |
| `pnpm analyze:db <path>`           | Analyze `.risu`, `db.json`, raw database JSON, or legacy data dirs. Add `--json` for machine-readable output. |
| `pnpm format`, `pnpm format:check` | Prettier write/check.                                                                                         |

There is no ESLint config or `lint` script.

## Local Dev

Run API and client in separate terminals:

```sh
pnpm api:dev
pnpm dev
```

For agent-driven work where source edits should not restart the API
automatically, use:

```sh
pnpm api:dev:flag
touch .risu-api-restart
```

The flag runner removes stale flags on startup and deletes the flag after
consuming a restart request. `RISU_API_RESTART_FLAG=/path/to/file` changes the
sentinel path.

`pnpm analyze:db` does not read current SQLite-only `data/` dirs unless they
also contain legacy `db.json`; use it for imported/exported JSON or `.risu`
inputs.

Vite proxies `/api` to `RISU_API_PROXY_TARGET` or `http://localhost:6002`.
Fastify defaults to `0.0.0.0:6002`. Vite dev changes only how the SPA bundle is
served; `src/ts/platform.ts` still makes the browser Fastify-backed.

To serve a built SPA through Fastify:

```sh
pnpm buildsite
pnpm api:start
```

`RISU_API_STATIC_ROOT` defaults to `<repo>/dist`; empty string, `none`, or `off`
disables Fastify static serving.

## Tests And Checks

| Area                        | Command/config                                                     | Environment | Locations                                                                   |
| --------------------------- | ------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------------- |
| Browser/client/domain tests | `pnpm test`, `vitest.config.ts`                                    | `happy-dom` | Root suite outside `server/**`, including `src/**` and `util/**/*.test.ts`. |
| Fastify/server tests        | `pnpm api:test`, `server/fastify/vitest.config.ts`                 | Node        | `server/fastify/__tests__/**/*.test.ts`.                                    |
| Browser smoke               | `pnpm smoke:fastify-browser`, `playwright.fastify-smoke.config.ts` | Chromium    | `server/fastify/browser-smoke/`.                                            |
| Architecture audit          | `pnpm client-thinning:audit`                                       | ts-morph    | Invariant checks in `util/client-thinning-audit.ts`.                        |

Pick the smallest command that covers the changed area. On a fresh machine, run
`pnpm exec playwright install chromium` before browser smoke.

Prompt/generation fixtures live in `src/ts/process/__fixtures__/`; set
`UPDATE_FIXTURES=1` to rewrite expected fixtures. Server `.risu` fixture helpers
live in `server/fastify/__fixtures__/risuSave/`. The architecture audit can be
scoped with `CLIENT_THINNING_AUDIT_CHECK_IDS`.

## TypeScript And Formatting

- Root `tsconfig.json` is browser-oriented, `strict: false`, allows JS, and uses
  bundler resolution.
- `server/fastify/tsconfig.json` is strict and references
  `tsconfig.client-lib.json`.
- Prettier uses `prettier-plugin-svelte`, no semicolons, single quotes, and
  print width 100.

Server TypeScript check workflow:

```sh
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Re-run the client-lib build after client source/type changes that affect server
imports.

## Environment Variables

Server:

| Variable                    | Default                    | Notes                                                                                                      |
| --------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `RISU_API_HOST`             | `0.0.0.0`                  | Fastify listen host.                                                                                       |
| `RISU_API_PORT`             | `6002`                     | Fastify listen port.                                                                                       |
| `RISU_API_DATA_DIR`         | `<repo>/data`              | SQLite, asset bytes, backups, auth files, legacy import artifacts.                                         |
| `RISU_API_BODY_LIMIT`       | `104857600`                | JSON/body and multipart file limit.                                                                        |
| `RISU_API_IMPORT_MAX_BYTES` | unlimited                  | Streamed device-backup import limit; positive byte count caps, `0`/`unlimited`/`none`/`infinity` opts out. |
| `TRUST_PROXY`               | `false`                    | Fastify trust proxy setting; accepts boolean, integer, or string.                                          |
| `RISU_API_STATIC_ROOT`      | `<repo>/dist`              | Static SPA root; empty, `none`, or `off` disables.                                                         |
| `RISU_HUB_URL`              | `https://sv.risuai.xyz`    | Hub passthrough target.                                                                                    |
| `RISU_REALM_URL`            | `https://realm.risuai.net` | Realm character import target.                                                                             |
| `LOG_LEVEL`                 | `info`                     | Use `silent` to disable Fastify logger.                                                                    |
| `RISU_PROTOCOL_METRICS`     | unset                      | Enables structured protocol metrics when `1`, `true`, `yes`, or `on`.                                      |

Local/dev:

| Variable                | Default             | Notes                                     |
| ----------------------- | ------------------- | ----------------------------------------- |
| `RISU_API_RESTART_FLAG` | `.risu-api-restart` | Flag file watched by `pnpm api:dev:flag`. |

Client/build:

| Variable                                                                         | Notes                                                            |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `RISU_API_PROXY_TARGET`                                                          | Vite dev proxy target for `/api`.                                |
| `VITE_RISU_LEGAL_CONFIGURED`                                                     | Controls legal/setup gating in builds and smoke.                 |
| `VITE_FASTIFY_BROWSER_SMOKE`                                                     | Enables browser smoke hook and fixed smoke password setup/login. |
| `VITE_RISU_LITE`                                                                 | Enables lite/mobile branch.                                      |
| `VITE_AD_CLIENT`, `VITE_AD_CLIENT_MOBILE`, `VITE_AD_SLOT`, `VITE_AD_SLOT_MOBILE` | Ad UI configuration.                                             |

Test/audit summary variables include `CLIENT_THINNING_AUDIT_CHECK_IDS`,
`UPDATE_FIXTURES`, `RISU_DIRECT_REALM_IMPORT_TEST`,
`RISU_COMMAND_METRIC_SUMMARY`, `RISU_PROJECTION_FULL_SUMMARY`,
`RISU_ASSET_BYTE_SUMMARY`, `RISU_EXPORT_MATERIALIZE_SUMMARY`, and
`RISU_GENERATION_METRIC_SUMMARY`.

## CI And Docker

`.github/workflows/` contains CodeQL scanning, Docker image build/publish, and
issue/comment moderation. It does not run the local check/test matrix.

`Dockerfile` uses Node 24 slim, installs pnpm through Corepack, builds the web
client with `pnpm build`, copies `server/` and `dist/`, sets production data and
static-root env vars, exposes `6002`, and persists `/app/data`.

`docker-compose.yml` uses `ghcr.io/kwaroran/risuai:latest`, maps `6002:6002`,
and creates a `risuai-data` volume.

`.dockerignore` currently ignores only `node_modules`, while the Dockerfile
copies the repository into the builder. Keep local ignored artifacts such as
`data/`, `dist/`, `test-results/`, `scripts/`, and `.env` out of the build
context or expand `.dockerignore` before relying on local image builds.
