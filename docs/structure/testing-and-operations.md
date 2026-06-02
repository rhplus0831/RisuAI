# Testing And Operations

Use `pnpm` for all package scripts.

## Scripts

| Command                      | Purpose                                                                                                                                                                                                        |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                   | Start Vite client dev server on `0.0.0.0:5174`.                                                                                                                                                                |
| `pnpm api:dev`               | Start Fastify with `tsx watch server/fastify/src/index.ts`.                                                                                                                                                    |
| `pnpm api:start`             | Start Fastify once with `tsx server/fastify/src/index.ts`.                                                                                                                                                     |
| `pnpm build`                 | Vite build with sourcemaps.                                                                                                                                                                                    |
| `pnpm buildsite`             | Production client build to `dist` with `VITE_RISU_LEGAL_CONFIGURED=TRUE`.                                                                                                                                      |
| `pnpm preview`               | Vite preview server for a built client bundle.                                                                                                                                                                 |
| `pnpm check`                 | Run `svelte-check --tsconfig ./tsconfig.json`.                                                                                                                                                                 |
| `pnpm test`                  | Run root/browser Vitest tests.                                                                                                                                                                                 |
| `pnpm api:test`              | Run Fastify/server Vitest tests.                                                                                                                                                                               |
| `pnpm api:dev:flag`          | Start Fastify through `util/api-flag-dev.ts`; restart only when `.risu-api-restart` is touched/created, then delete the consumed flag.                                                                         |
| `pnpm client-thinning:audit` | Run the ts-morph architecture audit (`util/client-thinning-audit.ts`, 26 AST/invariant checks). Exits non-zero on any finding; regression-tested by `util/client-thinning-audit.test.ts` under the root suite. |
| `pnpm analyze:db <path>`     | Run `util/analyze-database.ts` against a `.risu`, `db.json`, raw database JSON, or `data/` dir; add `--json` for machine-readable output.                                                                      |
| `pnpm smoke:fastify-browser` | Build site, then run Playwright Fastify browser smoke.                                                                                                                                                         |
| `pnpm format`                | Prettier write.                                                                                                                                                                                                |
| `pnpm format:check`          | Prettier check.                                                                                                                                                                                                |

There is no ESLint config or `lint` script currently.

## Local Dev

Run API and client in separate terminals:

```sh
pnpm api:dev
pnpm dev
```

For agent-driven work where source edits should not automatically restart the
API, use the flag-gated runner instead:

```sh
pnpm api:dev:flag
```

It starts the same Fastify entrypoint as `api:start`, removes any stale
`.risu-api-restart` on startup, and restarts only after that file is created or
edited. Touch the flag file whenever the API process should reset:

```sh
touch .risu-api-restart
```

The runner deletes the flag after consuming it, so agents can wait for the file
to disappear before assuming the restart request was handled.

Set `RISU_API_RESTART_FLAG=/path/to/file` to use a different sentinel.

Vite proxies `/api` to `RISU_API_PROXY_TARGET` or `http://localhost:6002`.
Fastify defaults to `0.0.0.0:6002`. The browser code is still Fastify-backed in
Vite dev because `src/ts/platform.ts` hard-codes `isFastifyServer = true`; Vite
only changes how the SPA bundle is served.

To build the SPA and serve it through Fastify:

```sh
pnpm buildsite
pnpm api:start
```

`pnpm build` also builds the client. `buildsite` matches the browser smoke's legal
flag behavior; Docker currently runs `pnpm build`, so its image build does not set
`VITE_RISU_LEGAL_CONFIGURED=TRUE` unless the Dockerfile is changed.

The package is root-only: there is no `server/fastify/package.json`. Node.js is
declared as `>=24.0.0`; `package.json` does not pin `packageManager`, and the
Dockerfile installs `pnpm@latest` through Corepack.

## Test Split

| Area                  | Config                               | Environment | Test Locations                                                                                |
| --------------------- | ------------------------------------ | ----------- | --------------------------------------------------------------------------------------------- |
| Browser/client/domain | `vitest.config.ts`                   | `happy-dom` | Root suite outside `server/**`, including `src/ts/**`, `src/lib/**`, and `util/**/*.test.ts`. |
| Fastify/server        | `server/fastify/vitest.config.ts`    | Node        | `server/fastify/__tests__/**/*.test.ts`.                                                      |
| Browser smoke         | `playwright.fastify-smoke.config.ts` | Chromium    | `server/fastify/browser-smoke/`.                                                              |

Root Vitest excludes `server/**`; server Vitest uses `server/fastify` as its
root. Pick the smallest command that covers the changed area.

Prompt/generation fixture data lives in `src/ts/process/__fixtures__/`. The
fixture update switch is `UPDATE_FIXTURES=1`.

The architecture audit can be scoped with `CLIENT_THINNING_AUDIT_CHECK_IDS`, a
comma-separated list of check ids from `util/client-thinning-audit.ts`.

Browser smoke uses Playwright Chromium. On a fresh machine, run
`pnpm exec playwright install chromium` before `pnpm smoke:fastify-browser`.

## TypeScript And Formatting

- Root `tsconfig.json` is browser-oriented, `strict: false`, allows JS, and uses
  bundler resolution.
- `server/fastify/tsconfig.json` is stricter, `strict: true`, `noEmit: true`,
  and includes Node types.
- Prettier uses `prettier-plugin-svelte`, no semicolons, single quotes, and
  print width 100.

## Environment Variables

Server:

| Variable                    | Default                    | Notes                                                                                                                            |
| --------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `RISU_API_HOST`             | `0.0.0.0`                  | Fastify listen host.                                                                                                             |
| `RISU_API_PORT`             | `6002`                     | Fastify listen port.                                                                                                             |
| `RISU_API_DATA_DIR`         | `<repo>/data`              | SQLite, `db.json`, assets, backups, auth files.                                                                                  |
| `RISU_API_BODY_LIMIT`       | `104857600`                | Body and multipart file limit.                                                                                                   |
| `RISU_API_IMPORT_MAX_BYTES` | unlimited                  | Separate streamed device-backup import limit; set a positive byte count to cap, or `0`/`unlimited`/`none`/`infinity` to opt out. |
| `TRUST_PROXY`               | `false`                    | Fastify trust proxy setting; accepts boolean, integer, or string.                                                                |
| `RISU_API_STATIC_ROOT`      | `<repo>/dist`              | Static SPA root; empty, `none`, or `off` disables.                                                                               |
| `RISU_HUB_URL`              | `https://sv.risuai.xyz`    | Hub passthrough target.                                                                                                          |
| `RISU_REALM_URL`            | `https://realm.risuai.net` | Realm character import target.                                                                                                   |
| `LOG_LEVEL`                 | `info`                     | Use `silent` to disable Fastify logger.                                                                                          |
| `RISU_PROTOCOL_METRICS`     | unset                      | Enables structured protocol metrics when set to `1`, `true`, `yes`, or `on`.                                                     |

Client/build:

| Variable                                                                         | Notes                                                                |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `RISU_API_PROXY_TARGET`                                                          | Vite dev proxy target for `/api`.                                    |
| `VITE_RISU_LEGAL_CONFIGURED`                                                     | Controls legal/setup gating in builds and smoke.                     |
| `VITE_FASTIFY_BROWSER_SMOKE`                                                     | Enables the browser smoke hook and fixed smoke password setup/login. |
| `VITE_RISU_LITE`                                                                 | Enables lite/mobile-ish UI path.                                     |
| `VITE_AD_CLIENT`, `VITE_AD_CLIENT_MOBILE`, `VITE_AD_SLOT`, `VITE_AD_SLOT_MOBILE` | Ad UI configuration.                                                 |

Test/audit:

| Variable                          | Notes                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------- |
| `CLIENT_THINNING_AUDIT_CHECK_IDS` | Optional comma-separated architecture-audit check-id selector.               |
| `UPDATE_FIXTURES`                 | Set to `1` to rewrite prompt/generation fixture snapshots.                   |
| `RISU_DIRECT_REALM_IMPORT_TEST`   | Auto-set by server Vitest config when `realmImport.test.ts` is run directly. |
| `RISU_COMMAND_METRIC_SUMMARY`     | Set to `1` for command metric review output in focused server tests.         |
| `RISU_PROJECTION_FULL_SUMMARY`    | Set to `1` for full-projection payload summary output in projection tests.   |
| `RISU_ASSET_BYTE_SUMMARY`         | Set to `1` for asset byte fanout summary output in asset tests.              |
| `RISU_EXPORT_MATERIALIZE_SUMMARY` | Set to `1` for export materialization summary output in save/export tests.   |
| `RISU_GENERATION_METRIC_SUMMARY`  | Set to `1` for generation metric summary output in chat generation tests.    |

## CI

`.github/workflows/` currently contains CodeQL scanning, Docker image
build/publish, and issue/comment moderation. There is no workflow that runs
`pnpm check`, `pnpm test`, `pnpm api:test`, `pnpm client-thinning:audit`,
`pnpm format:check`, or browser smoke; treat those as local verification unless
a CI workflow is added.

## Docker

`Dockerfile` uses Node 24 slim, installs pnpm via corepack, builds the web
client, and runs `pnpm api:start` in the runtime image. Runtime env sets:

- `NODE_ENV=production`
- `RISU_API_DATA_DIR=/app/data`
- `RISU_API_STATIC_ROOT=/app/dist`

The container exposes port `6002` and persists `/app/data`. `docker-compose.yml`
uses `ghcr.io/kwaroran/risuai:latest`, maps `6002:6002`, and creates a
`risuai-data` volume. The Docker publish workflow tags `latest` only for tagged
release builds; main-branch pushes publish a short-SHA image tag.

`.dockerignore` currently ignores only `node_modules`, while the Dockerfile
copies the repository into the builder. Keep local ignored runtime artifacts
such as `data/`, `dist/`, `test-results/`, `scripts/`, and `.env` out of the
build context or expand `.dockerignore` before relying on local image builds.

## Utility Scripts

Tracked utilities live under `util/`, including the architecture audit and
`util/risuUserscript.user.js`. Root `scripts/` is ignored scratch/local tooling
when present and is not part of the supported package-script surface.
