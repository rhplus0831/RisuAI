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
| `pnpm client-thinning:audit` | Run the ts-morph architecture audit (`util/client-thinning-audit.ts`, 23 AST/invariant checks). Exits non-zero on any finding; regression-tested by `util/client-thinning-audit.test.ts` under the root suite. |
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

Vite proxies `/api` to `RISU_API_PROXY_TARGET` or `http://localhost:6002`.
Fastify defaults to `0.0.0.0:6002`. This is Vite `web(dev)` mode, not true
Fastify-backed browser mode, because Vite does not inject `globalThis.__FASTIFY__`.

To build the SPA and serve it through Fastify:

```sh
pnpm buildsite
pnpm api:start
```

`pnpm build` also builds the client. `buildsite` matches the browser smoke's legal
flag behavior; Docker currently runs `pnpm build`, so its image build does not set
`VITE_RISU_LEGAL_CONFIGURED=TRUE` unless the Dockerfile is changed.

## Test Split

| Area                  | Config                               | Environment | Test Locations                                                                 |
| --------------------- | ------------------------------------ | ----------- | ------------------------------------------------------------------------------ |
| Browser/client/domain | `vitest.config.ts`                   | `happy-dom` | Root suite outside `server/**`, including `src/ts/**` and `util/**/*.test.ts`. |
| Fastify/server        | `server/fastify/vitest.config.ts`    | Node        | `server/fastify/__tests__/**/*.test.ts`.                                       |
| Browser smoke         | `playwright.fastify-smoke.config.ts` | Chromium    | `server/fastify/browser-smoke/`.                                               |

Root Vitest excludes `server/**`; server Vitest uses `server/fastify` as its
root. Pick the smallest command that covers the changed area.

Prompt/generation fixture data lives in `src/ts/process/__fixtures__/`. The
fixture update switch is `UPDATE_FIXTURES=1`.

The architecture audit can be scoped with `CLIENT_THINNING_AUDIT_CHECK_IDS`, a
comma-separated list of check ids from `util/client-thinning-audit.ts`.

## TypeScript And Formatting

- Root `tsconfig.json` is browser-oriented, `strict: false`, allows JS, and uses
  bundler resolution.
- `server/fastify/tsconfig.json` is stricter, `strict: true`, `noEmit: true`,
  and includes Node types.
- Prettier uses `prettier-plugin-svelte`, no semicolons, single quotes, and
  print width 100.

## Environment Variables

Server:

| Variable               | Default                 | Notes                                                             |
| ---------------------- | ----------------------- | ----------------------------------------------------------------- |
| `RISU_API_HOST`        | `0.0.0.0`               | Fastify listen host.                                              |
| `RISU_API_PORT`        | `6002`                  | Fastify listen port.                                              |
| `RISU_API_DATA_DIR`    | `<repo>/data`           | SQLite, `db.json`, assets, backups, auth files.                   |
| `RISU_API_BODY_LIMIT`  | `104857600`             | Body and multipart file limit.                                    |
| `TRUST_PROXY`          | `false`                 | Fastify trust proxy setting; accepts boolean, integer, or string. |
| `RISU_API_STATIC_ROOT` | `<repo>/dist`           | Static SPA root; empty, `none`, or `off` disables.                |
| `RISU_HUB_URL`         | `https://sv.risuai.xyz` | Hub passthrough target.                                           |
| `LOG_LEVEL`            | `info`                  | Use `silent` to disable Fastify logger.                           |

Client/build:

| Variable                                                                         | Notes                                                |
| -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `RISU_API_PROXY_TARGET`                                                          | Vite dev proxy target for `/api`.                    |
| `VITE_RISU_LEGAL_CONFIGURED`                                                     | Controls legal/setup gating in builds and smoke.     |
| `VITE_FASTIFY_BROWSER_SMOKE`                                                     | Enables browser smoke hook and auth bypass behavior. |
| `VITE_RISU_LITE`                                                                 | Enables lite/mobile-ish UI path.                     |
| `VITE_AD_CLIENT`, `VITE_AD_CLIENT_MOBILE`, `VITE_AD_SLOT`, `VITE_AD_SLOT_MOBILE` | Ad UI configuration.                                 |

Test/audit:

| Variable                          | Notes                                                          |
| --------------------------------- | -------------------------------------------------------------- |
| `CLIENT_THINNING_AUDIT_CHECK_IDS` | Optional comma-separated architecture-audit check-id selector. |

## Docker

`Dockerfile` uses Node 24 slim, installs pnpm via corepack, builds the web
client, and runs `pnpm api:start` in the runtime image. Runtime env sets:

- `NODE_ENV=production`
- `RISU_API_DATA_DIR=/app/data`
- `RISU_API_STATIC_ROOT=/app/dist`

The container exposes port `6002` and persists `/app/data`. `docker-compose.yml`
uses `ghcr.io/kwaroran/risuai:latest`, maps `6002:6002`, and creates a
`risuai-data` volume.
