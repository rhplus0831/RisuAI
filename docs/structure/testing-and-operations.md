# Testing And Operations

Use `pnpm` for package scripts. Node.js is declared as `>=24.0.0`. The package
is root-only; there is no `server/fastify/package.json`. `package.json` does not
pin a `packageManager`; the lockfile is pnpm lockfile v9 and Docker installs
pnpm through Corepack.

## Scripts

| Command                            | Purpose                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                         | Start Vite client dev server on `0.0.0.0:5174`.                                                               |
| `pnpm dev:agent`                   | Start full-stack agent dev server: frontend `6418`, Fastify `6419`, trace mode `agent`, auth/TOS bypass defaults. |
| `pnpm dev:human`                   | Start full-stack human trace server: frontend `6002`, Fastify `6001`, trace mode `human`, password auth enabled and TOS bypassed by default unless overridden. |
| `pnpm api:dev`                     | Start Fastify with `tsx watch server/fastify/src/index.ts`.                                                   |
| `pnpm api:dev:flag`                | Start Fastify through `util/api-flag-dev.ts`; restarts only when `.risu-api-restart` is touched/created.      |
| `pnpm api:start`                   | Start Fastify once with `tsx server/fastify/src/index.ts`.                                                    |
| `pnpm build`                       | Vite build with sourcemaps.                                                                                   |
| `pnpm build:site`                  | Production client build with `VITE_RISU_LEGAL_CONFIGURED=TRUE`.                                               |
| `pnpm preview`                     | Vite preview server for a built client bundle.                                                                |
| `pnpm check`                       | Run `svelte-check --tsconfig ./tsconfig.json`.                                                                |
| `pnpm test`                        | Alias for `pnpm test:frontend`; runs the default root/browser Vitest lane without explicit gate/audit tests.  |
| `pnpm test:frontend`               | Run default root/browser Vitest tests outside `server/**`, excluding explicit gate/audit tests.                |
| `pnpm test:frontend:all`           | Run all root/browser Vitest tests, including explicit gate/audit tests.                                        |
| `pnpm test:gates`                  | Run explicit frontend audit, completeness, clone-cost, and render-cost gates.                                  |
| `pnpm test:gates:audit`            | Run architecture-audit and UI-audit gate tests.                                                               |
| `pnpm test:gates:completeness`     | Run static audit/completeness registry gates.                                                                 |
| `pnpm test:gates:perf`             | Run render-cost, clone-count, and large-corpus fixture gates.                                                  |
| `pnpm test:server`                 | Run Fastify/server Vitest tests.                                                                              |
| `pnpm test:smoke`                  | Alias for `pnpm smoke:fastify-browser`.                                                                       |
| `pnpm test:all`                    | Run default frontend tests, explicit gates, and server tests, preserving a failing exit code if any lane fails. |
| `pnpm coverage:ui-map`             | Run the opt-in focused UI coverage map and write reports to `coverage/ui-map`.                                |
| `pnpm api:test`                    | Compatibility alias for `pnpm test:server`.                                                                  |
| `pnpm smoke:fastify-browser`       | Build site, then run Playwright Fastify browser smoke.                                                        |
| `pnpm client-thinning:audit`       | Run `util/client-thinning-audit.ts`.                                                                          |
| `pnpm analyze:db <path>`           | Analyze `.risu`, JSON, raw database JSON, or data dirs containing `db.json`; SQLite sidecars are copied when present. Add `--json` for machine-readable output. |
| `pnpm ts:agent <command>`          | Run the tsserver-backed agent debugging wrapper for navigation, diagnostics, symbols, code actions, imports, and renames. |
| `pnpm format`, `pnpm format:check` | Prettier write/check.                                                                                         |
| `pnpm coverage:frontend`           | Run root/browser Vitest tests with broad frontend coverage under `coverage/frontend`.                          |
| `pnpm coverage:backend`            | Run Fastify/server Vitest tests with broad backend coverage under `coverage/backend`.                          |
| `pnpm coverage:all`                | Run frontend and backend coverage, preserving a failing exit code if either side fails.                        |

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

`pnpm analyze:db` accepts `.risu`, JSON/database JSON, and data directories
that contain `db.json`; when matching SQLite sidecars are present it copies
those too. It does not inspect a current SQLite-only `data/` directory without a
legacy JSON payload.

Vite proxies `/api` to `RISU_API_PROXY_TARGET` or `http://localhost:6002`.
Fastify defaults to `0.0.0.0:6002`. Vite dev changes only how the SPA bundle is
served; `src/ts/platform.ts` still makes the browser Fastify-backed.

`pnpm dev:agent` and `pnpm dev:human` run both Fastify and Vite through
`util/agent-dev.ts`; they set `RISU_API_TRACE_MODE` to `agent` or `human`,
respect `RISU_AGENT_DEV_HOST` / `RISU_AGENT_DEV_PORT` /
`RISU_AGENT_API_PORT`, default `RISU_AGENT_DEV_AUTH_BYPASS=TRUE` for
`dev:agent` and `FALSE` for `dev:human` unless overridden, default
`RISU_API_STATIC_ROOT=none`, default `VITE_RISU_LEGAL_CONFIGURED=TRUE` and
`VITE_RISU_AGENT_DEV_IGNORE_TOS=TRUE`, and proxy `/api` to the spawned API port.
The spawned API uses `tsx watch`, so API source edits restart it; use
`pnpm api:dev:flag` when you need edit-triggered restarts to be manual.

Stop `pnpm dev:agent` when done so frontend port `6418` and API port `6419`
are released for the next agent. Do the same for `pnpm dev:human` when using
the human trace ports.

Request tracing writes API request traces under `data/trace/<mode>.jsonl`. Every
response receives `X-Request-UID`, but only API requests are appended to JSONL;
search that UID in the trace file to correlate a visible failure to one API call.
Each mode keeps the newest 5,000 entries and trims older entries, including
their gzip body sidecars. Entries include route pattern, caller hints, redacted
headers/query/body fields, and process/send timing. Text request/response bodies
up to 4 KiB are inlined; larger captured text bodies are written as `.gz`
sidecars under `data/trace/bodies/<mode>/` with a preview when the compressed
sidecar is at most 10 MiB. Oversized compressed bodies, multipart, binary, SSE,
and stream bodies are recorded as omitted metadata.

Generation trace sidecars are separate and opt in only when protocol metrics are
enabled and `RISU_GENERATION_TRACE_FULL_PROMPT=1`. They write redacted prompt
payloads under `data/trace/generation/`, capped by
`RISU_GENERATION_TRACE_FULL_PROMPT_MAX_GZIP_BYTES`.

Post-generation Lua flow tracing also uses `RISU_PROTOCOL_METRICS=1`. When
`editOutput` or `onOutput` Lua runs after provider completion, the server emits
`generation_lua_post_generation_trace`. The metric line stays metadata-only:
run counts, `editOutput` text changed, transcript changed, Lua `log()` count,
`LLM`/`axLLM` attempted/blocked/completed/failed counts, and `setChat` changed
counts. Its `bodySidecar` points at a compressed JSON file under
`data/trace/generation/` with the detailed chat body before/after each phase,
`editOutput` text before/after, and captured Lua `log()` values. Use this when
debugging whether post-generation Lua ran, whether `setChat` changed the
assistant row, or whether low-level LLM calls were blocked.

To serve a built SPA through Fastify:

```sh
pnpm build:site
pnpm api:start
```

`RISU_API_STATIC_ROOT` defaults to `<repo>/dist`; empty string, `none`, or `off`
disables Fastify static serving.

Tracked utilities that are not package-script-backed include
`util/risuUserscript.user.js`, a manual browser/userscript bridge. Treat it as a
source helper, not generated output.

## Tests And Checks

| Area                        | Command/config                                                     | Environment | Locations                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Browser/client/domain tests | `pnpm test` or `pnpm test:frontend`, `vitest.config.ts`            | `happy-dom` | Root suite outside `server/**`, including `src/**` and `util/**/*.test.ts`, minus explicit gate/audit tests.                |
| Explicit frontend gates     | `pnpm test:gates`, `vitest.config.ts`                              | `happy-dom` | `src/ts/__tests__/**/*.test.ts`, `src/lib/_audit/**/*.test.ts`, and `util/client-thinning-audit.test.ts`.                  |
| Full frontend tests         | `pnpm test:frontend:all`, `vitest.config.ts`                       | `happy-dom` | Root suite outside `server/**`, including explicit gate/audit tests.                                                       |
| Frontend coverage           | `pnpm coverage:frontend`, `vitest.config.ts`                       | `happy-dom` | Broad coverage over `src/**/*.{ts,svelte}` and `util/**/*.ts`, excluding audit fixtures; reports under `coverage/frontend`. |
| UI coverage map             | `pnpm coverage:ui-map`, `vitest.config.ts`                         | `happy-dom` | Focused UI integration tests mapped over `src/lib/ChatScreens`, `src/lib/Others`, `src/lib/SideBars`, and `src/ts/server`. |
| Fastify/server tests        | `pnpm test:server` or `pnpm api:test`, `server/fastify/vitest.config.ts` | Node        | `server/fastify/__tests__/**/*.test.ts`.                                                                                   |
| Backend coverage            | `pnpm coverage:backend`, `server/fastify/vitest.config.ts`         | Node        | Broad coverage over `server/fastify/src/**/*.ts`; reports under `coverage/backend`.                                        |
| Browser smoke               | `pnpm smoke:fastify-browser` or `pnpm test:smoke`, `playwright.fastify-smoke.config.ts` | Chromium    | `server/fastify/browser-smoke/`; specs start an in-process Fastify app on a random port serving `dist`.                     |
| Architecture audit          | `pnpm client-thinning:audit`                                       | ts-morph    | Source-level invariant checks in `util/client-thinning-audit.ts`; Vitest regression coverage is in `pnpm test:gates`.      |

Pick the smallest command that covers the changed area. On a fresh machine, run
`pnpm exec playwright install chromium` before browser smoke.

Config details: root Vitest uses `happy-dom`, browser resolve conditions, the
`src` alias, and `vitest.setup.ts` to mock `katex` and define
`safeStructuredClone`. It excludes explicit gate/audit tests unless
`RISU_TEST_INCLUDE_GATES=true` is set. `pnpm test:gates`, the
`pnpm test:gates:*` sub-lanes, `pnpm test:frontend:all`, and
`pnpm coverage:frontend` set that variable for the lanes that intentionally
include those files. Server Vitest uses Node, forks, a 15s test timeout, and
sets `RISU_DIRECT_REALM_IMPORT_TEST` only when the Realm import test is directly
selected. Playwright smoke is serial, one-worker Chromium with trace retained on
failure.

`pnpm coverage:frontend` and `pnpm coverage:backend` are broad coverage views for
coverage analysis. `pnpm coverage:all` runs both sides and still executes backend
coverage when frontend tests fail, then exits non-zero if either side failed.

`pnpm coverage:ui-map` is an opt-in map for Phase 5/6 UI state coverage, not a
default test gate. It uses `@vitest/coverage-v8`, runs the focused ChatScreens,
Others, and SideBars UI test files, and emits `text`, `json-summary`, and `html`
reports under `coverage/ui-map`. The repository ignores `coverage/`; keep all
coverage reports local unless a plan slice explicitly asks for extracted results.

Prompt/generation fixtures live in `src/ts/process/__fixtures__/`; set
`UPDATE_FIXTURES=1` to rewrite expected fixtures. Server `.risu` fixture helpers
live in `server/fastify/__fixtures__/risuSave/`. Explicit frontend gates live in
`src/ts/__tests__/` and `src/lib/_audit/`; keep audit/perf/completeness gates in
those places instead of mixing them into ordinary feature folders. The
architecture audit can be scoped with `CLIENT_THINNING_AUDIT_CHECK_IDS`.

## Visible State Test Contract

This is policy guidance for choosing current Fastify tests, not a new gate. When
a change affects state the user can see, validation must assert the rendered
result after the same transition that changes state. Helper/state assertions,
command payload assertions, and fetch mocks can support the test, but they are
not enough for stale-visible-UI bugs. If behavior includes optimistic updates or
rollback, assert both the visible optimistic change and the visible rollback.

Use helper Vitest for pure helpers and projection calculations, Svelte DOM
Vitest for state-to-DOM contracts, and sparse Fastify browser smoke for
end-to-end boot/API/SSE wiring. Add state-to-DOM coverage when touching
`DBState`, `selectedCharID`, `chatPage`, `loadedStore`, projection writes,
bootstrap/resync/SSE, optimistic command helpers, bridge watchers, router
selection, array create/delete/reorder flows, `$derived`, `$effect`, keyed lists,
memo signatures, or render dependency keys.

## TypeScript And Formatting

- Root `tsconfig.json` is browser-oriented, `strict: false`, allows JS, and uses
  bundler resolution.
- `tsconfig.client-lib.json` emits declarations only into `dist/client-types`
  for server imports from client code; `tsconfig.node.json` covers
  `vite.config.ts`.
- `server/fastify/tsconfig.json` is strict, `noEmit: true`, and references
  `tsconfig.client-lib.json`.
- Prettier uses `prettier-plugin-svelte`, no semicolons, single quotes, and
  print width 120.
- `.prettierignore` excludes Markdown docs, `docs/`, archived docs, and agent
  handoff notes. `pnpm format` will not normalize these files, so keep docs
  tables and wrapping tidy by inspection.

Server TypeScript check workflow:

```sh
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Re-run the client-lib build after client source/type changes that affect server
imports.

Agent TypeScript navigation wrapper:

```sh
pnpm ts:agent hover server/fastify/src/app.ts:87:23
pnpm ts:agent definition server/fastify/src/index.ts:134:37
pnpm ts:agent references server/fastify/src/app.ts:87:23 --include-declaration
pnpm ts:agent diagnostics server/fastify/src/app.ts
pnpm ts:agent diagnostics --project server/fastify/tsconfig.json
pnpm ts:agent symbols server/fastify/src/app.ts
pnpm ts:agent workspace-symbols buildApp --project server/fastify/tsconfig.json
pnpm ts:agent code-actions server/fastify/src/app.ts:87:23
pnpm ts:agent organize-imports server/fastify/src/app.ts
pnpm ts:agent project-files --project server/fastify/tsconfig.json
pnpm ts:agent rename-preview server/fastify/src/index.ts:45:17 nextSignalExitCode
```

Locations use 1-based `file:line:character` coordinates. The wrapper returns
JSON so agents can chain the safer loop `references -> diagnostics ->
rename-preview -> rename-apply -> diagnostics`. `rename-apply` and
`organize-imports --write` modify files, so inspect `git diff` after using them.
Use `pnpm ts:agent --help` as the canonical command/flag list. Useful global
flags include `--project`, `--absolute`, `--compact`, and `--timeout-ms`. Set
`RISU_TS_AGENT_TSSERVER_LOG=1` to capture a verbose tsserver log at
`data/trace/tsserver-agent.log` when debugging the wrapper itself.

## Environment Variables

Server:

| Variable                     | Default                    | Notes                                                                                                      |
| ---------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `RISU_API_HOST`              | `0.0.0.0`                  | Fastify listen host.                                                                                       |
| `RISU_API_PORT`              | `6002`                     | Fastify listen port.                                                                                       |
| `RISU_API_DATA_DIR`          | `<repo>/data`              | SQLite, asset bytes, backups, auth files, legacy import artifacts.                                         |
| `RISU_API_BODY_LIMIT`        | `104857600`                | JSON/body and multipart file limit.                                                                        |
| `RISU_API_IMPORT_MAX_BYTES`  | unlimited                  | Streamed device-backup import limit; positive byte count caps, `0`/`unlimited`/`none`/`infinity` opts out. |
| `RISU_REALM_IMPORT_MAX_EXPANDED_BYTES` | `325058560`       | Expanded payload cap for streamed Realm `charx` imports and Realm-fetched asset totals.                    |
| `RISU_API_TRACE_MODE`        | unset                      | Enables API request tracing when `agent` or `human`; `0`/`false`/`off`/`none` disable it.                  |
| `RISU_GENERATION_TRACE_FULL_PROMPT` | unset              | Set to `1` with protocol metrics enabled to write redacted generation prompt sidecars under `data/trace/generation/`. |
| `RISU_GENERATION_TRACE_FULL_PROMPT_MAX_GZIP_BYTES` | `10485760` | Maximum compressed sidecar size for full-prompt generation traces.                                         |
| `RISU_WEB_PUSH_VAPID_PUBLIC_KEY` | unset                  | Optional Web Push VAPID public key. If public/private keys are omitted, the server can generate and persist keys under `data/__web_push_vapid_keys.json`. |
| `RISU_WEB_PUSH_VAPID_PRIVATE_KEY` | unset                 | Optional Web Push VAPID private key. Must be supplied with the public key when using env-provided keys.     |
| `RISU_WEB_PUSH_CONTACT`      | unset                      | Optional Web Push contact subject used for VAPID details, such as a `mailto:` URL.                         |
| `TRUST_PROXY`                | `false`                    | Fastify trust proxy setting; accepts boolean, integer, or string.                                          |
| `RISU_API_STATIC_ROOT`       | `<repo>/dist`              | Static SPA root; empty, `none`, or `off` disables.                                                         |
| `RISU_HUB_URL`               | `https://sv.risuai.xyz`    | Hub passthrough target.                                                                                    |
| `RISU_REALM_URL`             | `https://realm.risuai.net` | Realm character import target.                                                                             |
| `RISU_AGENT_DEV_AUTH_BYPASS` | unset                      | Dev escape hatch; `dev:agent` defaults it to `TRUE`, while `dev:human` defaults it to `FALSE`.             |
| `LOG_LEVEL`                  | `info`                     | Use `silent` to disable Fastify logger.                                                                    |
| `RISU_PROTOCOL_METRICS`      | unset                      | Enables structured protocol metrics when `1`, `true`, `yes`, or `on`.                                      |

Local/dev:

| Variable                         | Default             | Notes                                                                                 |
| -------------------------------- | ------------------- | ------------------------------------------------------------------------------------- |
| `RISU_API_RESTART_FLAG`          | `.risu-api-restart` | Flag file watched by `pnpm api:dev:flag`.                                             |
| `RISU_AGENT_DEV_HOST`            | `0.0.0.0`           | Host used by `pnpm dev:agent` / `pnpm dev:human` for both spawned processes.          |
| `RISU_AGENT_DEV_PORT`            | `6418`              | Frontend port for `pnpm dev:agent`; `pnpm dev:human` sets it to `6002`.               |
| `RISU_AGENT_API_PORT`            | `6419`              | Fastify port for `pnpm dev:agent`; `pnpm dev:human` sets it to `6001`.                |
| `RISU_AGENT_DEV_AUTH_BYPASS`     | `TRUE` for `dev:agent`, `FALSE` for `dev:human` | Protected API routes ignore password auth when enabled. |
| `RISU_TS_AGENT_TSSERVER_LOG`     | unset               | Set to `1` or a path to capture verbose `pnpm ts:agent` tsserver logs.                |
| `RISU_TS_AGENT_TIMEOUT_MS`       | `30000`             | Default tsserver request timeout for `pnpm ts:agent`; `--timeout-ms` overrides it.    |
| `RISU_TS_AGENT_DEBUG`            | unset               | Echo tsserver stderr while debugging `pnpm ts:agent`.                                 |
| `VITE_RISU_AGENT_DEV_IGNORE_TOS` | `TRUE`              | Set by `pnpm dev:agent` / `pnpm dev:human`; `alertTOS()` returns accepted without showing the TOS modal. |

Client/build:

| Variable                                                                         | Notes                                                            |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `RISU_API_PROXY_TARGET`                                                          | Vite dev proxy target for `/api`.                                |
| `VITE_RISU_LEGAL_CONFIGURED`                                                     | Controls legal/setup gating in builds and smoke.                 |
| `VITE_FASTIFY_BROWSER_SMOKE`                                                     | Enables browser smoke hook and fixed smoke password setup/login. |
| `VITE_RISU_LITE`                                                                 | Enables lite-mode consumers in settings/theme/legacy mobile code; does not mount `LiteMain` or the legacy mobile shell. |
| `VITE_AD_CLIENT`, `VITE_AD_CLIENT_MOBILE`, `VITE_AD_SLOT`, `VITE_AD_SLOT_MOBILE` | Ad UI configuration.                                             |

Test/audit summary variables include `CLIENT_THINNING_AUDIT_CHECK_IDS`,
`UPDATE_FIXTURES`, `RISU_DIRECT_REALM_IMPORT_TEST`,
`RISU_COMMAND_METRIC_SUMMARY`, `RISU_PROJECTION_FULL_SUMMARY`,
`RISU_ASSET_BYTE_SUMMARY`, `RISU_EXPORT_MATERIALIZE_SUMMARY`, and
`RISU_GENERATION_METRIC_SUMMARY`.

## CI And Docker

`.github/workflows/` contains CodeQL scanning (`codeql.yml`), Docker image
build/publish (`docker-build.yml`), and issue/comment moderation (`mod.yml`).
No workflow for the local `pnpm check` / Vitest / Playwright matrix was found
in this audit.

`Dockerfile` uses Node 24 slim, installs pnpm through Corepack, builds the web
client with plain `pnpm build` rather than `build:site`, copies `server/` and
`dist/`, sets production data and static-root env vars, exposes `6002`, and
persists `/app/data`. It does not bake in
`VITE_RISU_LEGAL_CONFIGURED=TRUE` unless the build environment supplies it.

`docker-compose.yml` uses `ghcr.io/kwaroran/risuai:latest`, maps `6002:6002`,
and creates a `risuai-data` volume.

`.dockerignore` currently ignores only `node_modules`, while the Dockerfile
copies the repository into the builder. Keep local ignored artifacts such as
`data/`, `dist/`, `test-results/`, `scripts/`, and `.env` out of the build
context or expand `.dockerignore` before relying on local image builds.
