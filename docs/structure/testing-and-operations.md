# Testing And Operations

Last audited: 2026-08-25.

Use `pnpm` for package scripts. Node.js is declared as `>=24.0.0`. The package
is root-only; there is no `server/fastify/package.json`. `package.json` does not
pin a `packageManager`; the lockfile is pnpm lockfile v9.

## Scripts

| Command                            | Purpose                                                                                                                                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                         | Start Vite client dev server on `0.0.0.0:5174`.                                                                                                                               |
| `pnpm dev:agent`                   | Start full-stack agent dev server: frontend `6418`, Fastify `6419`, trace mode `agent`, auth/RisuRealm-terms bypass, and disposable `data-agent/` sandbox defaults.            |
| `pnpm dev:human`                   | Start full-stack human trace server: frontend `6002`, Fastify `6001`, trace mode `human`, password auth enabled and RisuRealm terms bypassed by default unless overridden.    |
| `pnpm api:dev`                     | Start Fastify with `tsx watch server/fastify/src/index.ts`.                                                                                                                   |
| `pnpm api:dev:flag`                | Start Fastify through `util/api-flag-dev.ts`; restarts only when `.risu-api-restart` is touched/created.                                                                      |
| `pnpm api:start`                   | Start Fastify once with `tsx server/fastify/src/index.ts`.                                                                                                                    |
| `pnpm build`                       | Vite build with sourcemaps.                                                                                                                                                   |
| `pnpm report:bundle-boundaries`    | Validate the generated entry/static closure against protected optional/database/export boundaries and write JSON/text reports.                                              |
| `pnpm report:initial-preload`      | Measure JavaScript referenced by built `index.html`, enforce the ratified total/largest-file budgets, and write JSON/text reports.                                          |
| `pnpm build:initial-preload`       | Production build with the boundary plugin, followed by both boundary and initial-preload reports.                                                                          |
| `pnpm measure:fast-bootstrap`      | Run the initial-preload build/report, browser-smoke build, and small/large cold/warm Phase 0 startup matrix.                                                                |
| `pnpm verify:fast-bootstrap:phase7` | Run the complete measurement command and the Phase 7 direct-link, replay, event-gap, writer-takeover, observer, and optional-runtime browser matrix.                      |
| `pnpm preview`                     | Vite preview server for a built client bundle.                                                                                                                                |
| `pnpm check`                       | Run `svelte-check --tsconfig ./tsconfig.json`.                                                                                                                                |
| `pnpm check:server`                | Emit client-library declarations, then typecheck strict Fastify and Playwright browser-smoke projects without emitting server code.                                           |
| `pnpm test`                        | Alias for `pnpm test:frontend`; runs the default root/browser Vitest lane without explicit gate tests.                                                                        |
| `pnpm test:quick`, `pnpm test:affected` | Run changed test files directly or use Vitest dependency selection for changed source files; defaults to the uncommitted diff against `HEAD`.                            |
| `pnpm test:frontend`               | Run default root/browser Vitest tests outside `server/**`, excluding explicit gate tests.                                                                                     |
| `pnpm test:frontend:all`           | Run all root/browser Vitest tests, including explicit gate tests.                                                                                                             |
| `pnpm test:gates`                  | Run two mounted visible-state UI gates plus render-cost and send-clone performance gates.                                                                                     |
| `pnpm test:gates:audit`            | Run UI-audit gate tests.                                                                                                                                                      |
| `pnpm test:gates:perf`             | Run render-cost and clone-count gates.                                                                                                                                        |
| `pnpm test:server`                 | Run Fastify/server Vitest tests.                                                                                                                                              |
| `pnpm test:compat-harness`         | Compare pinned local/Fastify generation matrices against a prepared pre-Fastify worktree; opt-in and not part of `test:all`.                                                 |
| `pnpm test:smoke`                  | Alias for `pnpm smoke:fastify-browser`.                                                                                                                                       |
| `pnpm test:all`                    | Run format, Svelte, strict server/browser-smoke TypeScript, frontend tests, explicit gates, the UI coverage gate, server tests, and browser smoke; preserve any failing lane. |
| `pnpm coverage:ui-map`             | Run the focused UI coverage gate and write text/JSON reports to `coverage/ui-map`; use `coverage:ui-map:html` for an on-demand HTML report.                                   |
| `pnpm api:test`                    | Compatibility alias for `pnpm test:server`.                                                                                                                                   |
| `pnpm smoke:fastify-browser`       | Build the smoke client without production sourcemaps, then run Playwright Fastify browser smoke.                                                                             |
| `pnpm analyze:db <path>`           | Analyze `.risu`, JSON, raw database JSON, or data dirs containing `db.json`; SQLite sidecars are copied when present. Add `--json` for machine-readable output.               |
| `pnpm ts:agent <command>`          | Run the tsserver-backed agent debugging wrapper for navigation, diagnostics, symbols, code actions, imports, and renames.                                                     |
| `pnpm format`, `pnpm format:check` | Prettier write/check.                                                                                                                                                         |
| `pnpm coverage:frontend`           | Run root/browser Vitest tests with broad frontend coverage under `coverage/frontend`.                                                                                         |
| `pnpm coverage:backend`            | Run Fastify/server Vitest tests with broad backend coverage under `coverage/backend`.                                                                                         |
| `pnpm coverage:all`                | Run frontend and backend coverage, preserving a failing exit code if either side fails.                                                                                       |

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
`RISU_API_STATIC_ROOT=none`, default `VITE_RISU_AGENT_DEV_IGNORE_REALM_TERMS=TRUE`,
and proxy `/api` to the spawned API port.
The shared runner host defaults to `127.0.0.1`, not the network-visible Fastify
default, because agent mode bypasses authentication; set `RISU_AGENT_DEV_HOST`
explicitly only when a wider bind is intentional.
The spawned API uses `tsx watch`, so API source edits restart it; use
`pnpm api:dev:flag` when you need edit-triggered restarts to be manual.
Vite scans all production TypeScript and Svelte modules for dependencies during
startup, including lazy routes and optional frontend features, while excluding
tests, fixtures, declarations, and test harnesses. The resulting pre-bundle is
cached under `node_modules/.vite/` for later `dev:agent` and `dev:human` runs.

In agent mode without an explicit `RISU_API_DATA_DIR`, the runner prepares
`data-agent/` before spawning Fastify. Default `clone` mode takes an online
SQLite snapshot and links or copies `assets/` and `save/`; it intentionally
omits auth files, backups, traces, and Web Push keys. `fresh` starts empty, while
`keep` reuses the existing sandbox. Human mode uses `data/` directly.

Stop `pnpm dev:agent` when done so frontend port `6418` and API port `6419`
are released for the next agent. Do the same for `pnpm dev:human` when using
the human trace ports.

Tracked utilities that are not package-script-backed include
`util/risuUserscript.user.js`, a manual browser/userscript bridge. Treat it as a
source helper, not generated output.

## Request And Generation Tracing

Request tracing writes under the active server data directory as
`trace/<mode>.jsonl`. The standard runners therefore use
`data-agent/trace/agent.jsonl` for `dev:agent` and `data/trace/human.jsonl` for
`dev:human`. While tracing is enabled, every response receives
`X-Request-UID`, but only API requests are appended to JSONL; search that UID in
the trace file to correlate a visible failure to one API call.
Each mode keeps the newest 5,000 entries and trims older entries, including
their gzip body sidecars. Entries include route pattern, caller hints, redacted
headers/query/body fields, and process/send timing. Text request/response bodies
up to 4 KiB are inlined; larger captured text bodies are written as `.gz`
sidecars under `<data-dir>/trace/bodies/<mode>/` with a preview when the
compressed sidecar is at most 10 MiB. Oversized compressed bodies, multipart,
binary, SSE, and stream bodies are recorded as omitted metadata.

Generation trace sidecars are separate and opt in only when protocol metrics are
enabled and `RISU_GENERATION_TRACE_FULL_PROMPT=1`. They write redacted
prompt-emission payloads and OpenAI/Gemini provider request bodies under
`<data-dir>/trace/generation/`, capped by
`RISU_GENERATION_TRACE_FULL_PROMPT_MAX_GZIP_BYTES`.

Post-generation Lua flow tracing also uses `RISU_PROTOCOL_METRICS=1`. When
`editOutput` or `onOutput` Lua runs after provider completion, the server emits
`generation_lua_post_generation_trace`. The metric line stays metadata-only:
run counts, `editOutput` text changed, transcript changed, Lua `log()` count,
`LLM`/`axLLM` attempted/blocked/completed/failed counts, and `setChat` changed
counts. Its `bodySidecar` points at a compressed JSON file under
`<data-dir>/trace/generation/` with the detailed chat body before/after each
phase, `editOutput` text before/after, and captured Lua `log()` values. Use this
when debugging whether post-generation Lua ran, whether `setChat` changed the
assistant row, or whether low-level LLM calls were blocked.
Lua sidecars require protocol metrics but not the full-prompt flag; they use the
same compressed-size cap. These files can retain redacted user prompt/chat
content and should not be shared casually.

## Browser Startup Telemetry

Browser startup telemetry is an opt-in `browser_startup` protocol metric. Set
`RISU_PROTOCOL_METRICS=1` (or another documented truthy value) on a Fastify
instance to advertise `{ version: 1, sampleRate: 1 }` in its authenticated
bootstrap response. The browser starts a best-effort publisher before its first
startup attempt, but sends nothing unless that response opts in. A missing,
malformed, or unsupported configuration disables collection and clears the
pending queue. Version 1 is deliberately unsampled: `sampleRate: 1` means every
startup served by an opted-in instance is measured. Use deployment/server
cohorts for a bounded rollout; version 1 does not perform per-browser random
sampling.

The authenticated `POST /api/v1/telemetry/startup` route accepts at most 16 KiB
and 32 events per batch without requiring active-writer ownership. Before
opt-in, the browser retains at most 64 metadata events in memory. It removes a
batch before requesting auth or sending, uses `keepalive`, does not await the
request from the readiness path, and never retries a failed batch. There is no
startup-telemetry table or sidecar: Fastify emits validated events only through
the existing structured logger and in-process metric subscribers. The
application therefore has no durable raw-event retention of its own. A rollout
log sink must cap raw `browser_startup` retention at 14 days; derived aggregates
may be retained for at most 90 days. Record the sink owner and deletion policy
before using those aggregates for a rollout decision.

The v1 event contract contains only:

- `phase-ready`: stable milestone, monotonic duration from `entry`, bounded
  attempt count, and observer-shell rollout mode;
- `attempt-completed`: bounded attempt duration, attempt count, and rollout
  mode;
- `attempt-failed`: those attempt fields plus a stable failure code and
  milestone; and
- `diagnostic-failure`: a stable code and milestone for a localized capability
  failure that did not necessarily fail the startup attempt.

The server adds only schema version and the random request UID used to correlate
the fixed telemetry endpoint with request timing. Exact-key validation rejects
unknown or content-bearing fields. Character, chat, message, prompt,
plugin-storage, credential, account, and route-content values are not part of
the contract. Request tracing records the fixed route and timing but always
marks its request body `telemetry-metadata`; it never stores the body inline or
in a gzip sidecar. Auth headers retain the request tracer's normal redaction.

Aggregate `phase-ready.entryDurationMs` and
`attempt-completed.attemptDurationMs` as distributions grouped by schema
version, milestone, and `observerShellEnabled`. Track retry pressure from
`attemptCount`, fatal startup outcomes from `attempt-failed`, and localized
capability health from `diagnostic-failure`. Do not group by request UID or join
it to user/domain data. Compare small/large-database and observer flag-off/on
cohorts before rollout; a duration regression, rising retry count, or new fatal
failure rate blocks promotion even if background readiness eventually arrives.

### Startup failure-code taxonomy

| Code | Meaning |
| --- | --- |
| `writer-bootstrap-failed` | The writer bootstrap attempt could not establish its required observer/writer boundary. |
| `push-initialization-failed` | Optional push-notification runtime initialization failed before background readiness. |
| `plugin-initialization-failed` | Plugin runtime initialization did not reach coherent plugin readiness. |
| `generation-recovery-failed` | Startup could not reconcile or reattach the active generation projection. |
| `selected-character-hydration-failed` | The selected character detail needed for chat readiness could not be hydrated. |
| `selected-chat-hydration-failed` | The selected chat/message projection needed for chat readiness could not be hydrated. |
| `selected-prompt-template-hydration-failed` | The selected prompt-template detail needed for generation could not be hydrated. |
| `runtime-initialization-failed` | Another optional background runtime failed before background readiness. |

Telemetry is diagnostic-only on both sides. Browser listener exceptions,
authentication failures, network errors, and rejected fetch promises are
caught or detached. Server logger/subscriber exceptions are isolated from the
204 response. None of these paths can grant, revoke, delay, or otherwise change
`canRenderShell`, `canApplyRoutes`, `canMutate`, or `canGenerate`.

## Fast Bootstrap Measurement And Rollout Gate

Use Node.js 24 or newer, install Chromium once with
`pnpm exec playwright install --with-deps chromium`, and run:

```sh
pnpm verify:fast-bootstrap:phase7
```

This is the one-command local initiative gate. It runs
`measure:fast-bootstrap` first: a production initial-preload/boundary build, a
browser-smoke build, and the Phase 0 small/large cold/warm startup matrix. It
then runs the Phase 7 integration matrix. Each browser journey gets a disposable
authenticated Fastify instance, temporary SQLite/data directory, request trace,
and imported fixture; writer identity, outbox state, cache state, and revisions
do not leak between journeys.

The small fixture in `server/fastify/browser-smoke/fastBootstrapHarness.ts` is a
minimal deterministic character/chat database. The large fixture in
`src/ts/__tests__/largeCorpusFixture.ts` is shared with client/server load-cost
tests and deliberately expands characters, chats, messages, collections,
lorebooks, and summary fields. Phase 0 keeps cold browser/resource cache and warm
browser/resource cache as separate populations. Phase 7 runs both fixtures with
the observer override disabled and enabled, derives direct-link cases from the
production route manifest, and uses isolated fixtures for replay, event-gap,
takeover, and failure-injection journeys.

Generated files are local evidence and are ignored by Git:

| Files under `fast-bootstrap-results/` | Contents |
| ------------------------------------- | -------- |
| `bundle-boundaries.json` / `.txt` | Entry and immediate-startup closures, HTML-preload agreement, protected-boundary violations, and largest chunks. |
| `initial-preload.json` / `.txt` | Initial JavaScript files, raw/gzip totals, largest file, and both budget comparisons. |
| `startup-matrix.json` / `.txt` | Small/large cold/warm milestones, payload/cache totals, early mutation/generation counts, request UIDs, and safe trace summaries. |
| `phase7-integration.json` / `.txt` | Observer flag-off/on timings, direct links, replay/event-gap results, takeover results, and optional-runtime failure/retry results. |

`util/initial-preload-budgets.json` is authoritative. The ratified hard gates are
921,600 bytes (900 KiB) total initial JavaScript gzip and 512,000 bytes (500
KiB) for the largest initial file. The historical 1,650,000/675,000-byte
regression ceilings remain visible as baseline context; the report exits nonzero
when either comparison fails. The boundary report independently fails when the
HTML preload list differs from the computed entry closure or when a protected
database, export, or optional-surface module re-enters that closure. Startup
matrices additionally require zero user mutation before `writer-ready` and zero
generation before `chat-ready`.

Interpret failures from the first failing layer:

1. For `build:initial-preload`, inspect `bundle-boundaries.txt` first for a
   closure mismatch or named module violation, then `initial-preload.txt` for the
   total/largest-file budget and per-file contribution. Do not loosen a budget
   without before/after artifacts and a named dependency.
2. For the Phase 0 matrix, compare cold only with cold and warm only with warm.
   Check milestone ordering/durations, resource payload/cache totals, and the two
   early-request counters. The JSON request UIDs and safe trace summaries identify
   the resource or bootstrap call responsible for a payload/timing change.
3. For Phase 7, read the matching section of `phase7-integration.txt`: startup
   rollout, direct links, recovery, writer, or optional runtime. The JSON retains
   exact revisions, command attempts, receipt acknowledgements, requested paths,
   capabilities, localized failure state, and Retry outcome. Playwright retains
   a trace on failure under `test-results/` when the browser/UI transition itself
   needs inspection.
4. In an agent or human dev session, take the response's `X-Request-UID` and run
   `rg "<uid>" data-agent/trace/*.jsonl` or
   `rg "<uid>" data/trace/*.jsonl`. Startup telemetry failures use the stable
   taxonomy above; route/content values are intentionally absent.

CI runs `pnpm build:initial-preload` in its dedicated initial-preload lane and
uploads both report families. The normal smoke lane uploads the startup matrix
and Playwright results. Do not commit `fast-bootstrap-results/`, `test-results/`,
`dist/`, trace data, or temporary fixture databases.

## Built SPA Serving

To serve a built SPA through Fastify:

```sh
pnpm build
pnpm api:start
```

`RISU_API_STATIC_ROOT` defaults to `<repo>/dist`; empty string, `none`, or `off`
disables Fastify static serving.

## Browser Support

The production client follows Vite's `baseline-widely-available` target as of
Vite 8: Chrome and Edge 111+, Firefox 114+, and Safari/iOS 16.4+. Vite applies
syntax transforms for this target but does not add runtime polyfills.

`src/ts/polyfill.ts` therefore checks only runtime features used by the client
and loads their focused `core-js` modules when a claimed runtime is incomplete.
Buffer, stream constructors, and mobile drag/drop are installed before the full
application module graph is evaluated; their implementations are downloaded
only when the corresponding native/global capability is absent or the platform
requires the drag/drop workaround.

## Tests And Checks

| Area                        | Command/config                                                                          | Environment | Locations                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Browser/client/domain tests | `pnpm test` or `pnpm test:frontend`, `vitest*.config.ts`                                | Node + `happy-dom` | Root suite outside `server/**`, including `src/**` and `util/**/*.test.ts`, minus explicit gate tests.                |
| Explicit frontend gates     | `pnpm test:gates`, `vitest.config.ts`                                                   | `happy-dom` | `src/ts/__tests__/**/*.test.ts` and `src/lib/_audit/**/*.test.ts`.                                                         |
| Full frontend tests         | `pnpm test:frontend:all`, `vitest.config.ts`                                            | `happy-dom` | Root suite outside `server/**`, including explicit gate tests.                                                             |
| Frontend coverage           | `pnpm coverage:frontend`, `vitest.config.ts`                                            | `happy-dom` | Broad coverage over `src/**/*.{ts,svelte}` and `util/**/*.ts`; reports under `coverage/frontend`.                          |
| UI coverage map             | `pnpm coverage:ui-map`, `vitest.config.ts`                                              | `happy-dom` | Focused UI integration tests mapped over `src/lib/ChatScreens`, `src/lib/Others`, `src/lib/SideBars`, and `src/ts/server`. |
| Fastify/server tests        | `pnpm test:server` or `pnpm api:test`, `server/fastify/vitest.config.ts`                | Node        | `server/fastify/__tests__/**/*.test.ts`.                                                                                   |
| Compatibility harness      | `pnpm test:compat-harness`, `test/compat-harness/*.vitest.config.ts`                    | Node        | Golden pre-Fastify/current generation matrix plus focused replay/continue regressions; opt-in and outside `test:all`.      |
| Backend coverage            | `pnpm coverage:backend`, `server/fastify/vitest.config.ts`                              | Node        | Broad coverage over `server/fastify/src/**/*.ts`; reports under `coverage/backend`.                                        |
| Browser smoke               | `pnpm smoke:fastify-browser` or `pnpm test:smoke`, `playwright.fastify-smoke.config.ts` | Chromium    | `server/fastify/browser-smoke/`; specs start an in-process Fastify app on a random port serving `dist`.                    |

Pick the smallest command that covers the changed area. `pnpm test:affected`
uses exact paths when only tests changed and dependency-aware `--changed`
selection when source changed. `--base <git-ref>` selects a branch diff,
`--dry-run` prints the plan, `--include-smoke` opts into relevant Playwright
work, and `--all` selects `test:all`. Deleted tests/source and runner changes
conservatively widen to their complete lanes. On a fresh machine, run
`pnpm exec playwright install --with-deps chromium` before browser smoke.
`server/fastify/__tests__/README.md` is the maintained topical map for the flat
Fastify test directory; use it to find command/persistence, generation, memory,
provider, job, asset/import, and platform/route coverage.

The compatibility harness requires the pinned baseline worktree and its
dependencies at the path declared in `test/compat-harness/run.ts`. Set
`UPDATE_COMPAT_HARNESS=1` only when intentionally refreshing its tracked golden
artifacts. It is excluded from `pnpm test:all` because that external worktree is
not a normal checkout prerequisite.

Config details: `vitest.config.ts` composes two thread-pool projects. The
conservative allowlist in `vitest.node-tests.ts` runs validated pure tests in
Node without loading `happy-dom`; new frontend tests default to the Svelte /
`happy-dom` project until deliberately promoted. Both projects retain browser
resolve conditions, the `src` alias, and `vitest.setup.ts` to mock `katex` and
install the shared production `safeStructuredClone` helper. The DOM project
also loads `vitest.dom.setup.ts`, which blocks unexpected fetches resolving to
loopback port `3000` and reports the originating stack; tests that perform
network-shaped work must stub `fetch` explicitly and await fire-and-forget
command drains before teardown. `vitest.setup.test.ts` protects the shared
native, fallback, and global-restoration semantics, while
`vitest.fetchGuard.test.ts` protects the DOM fetch boundary. Root Vitest
excludes explicit gate tests unless
`RISU_TEST_INCLUDE_GATES=true` is set.
`pnpm test:gates`, the
`pnpm test:gates:*` sub-lanes, `pnpm test:frontend:all`, and
`pnpm coverage:frontend` set that variable for the lanes that intentionally
include those files. Server Vitest uses Node, forks, a 15s test timeout, and
sets `RISU_DIRECT_REALM_IMPORT_TEST` only when the Realm import test is directly
selected. Playwright smoke is serial, one-worker Chromium with trace retained on
failure, and rejects focused tests when CI is truthy.
Both Vitest configs set `allowOnly: false`. Directly selecting
`realmImport.test.ts` also enables its otherwise skipped 7,000-asset stress case.

`pnpm coverage:frontend` and `pnpm coverage:backend` are broad coverage views for
reporting and enforce no thresholds. `pnpm coverage:all` runs both sides and still executes backend
coverage when frontend tests fail, then exits non-zero if either side failed.

`pnpm coverage:ui-map` is the focused UI state coverage gate included in
`pnpm test:all`. It uses `@vitest/coverage-v8`, runs the focused ChatScreens,
Others, and SideBars UI test files, enforces line `8%`, statement `7%`, function
`5%`, and branch `4%` thresholds, and emits `text` and `json-summary` reports
under `coverage/ui-map`. `pnpm coverage:ui-map:html` additionally emits HTML on
demand. The repository ignores `coverage/`; keep all coverage reports local
unless a plan slice explicitly asks for extracted results.

Browser smoke also owns tracked desktop/mobile screenshot baselines under
`server/fastify/browser-smoke/*-snapshots/`. The core-chat and blocking-alert
assertions are part of `pnpm test:smoke`, so update those PNGs only for an
intentional visible change.

Prompt/generation fixtures live in `src/ts/process/__fixtures__/`; set
`UPDATE_FIXTURES=1` to rewrite expected fixtures. Server `.risu` fixture helpers
live in `server/fastify/__fixtures__/risuSave/`. Explicit frontend gates live in
`src/ts/__tests__/` and `src/lib/_audit/`; keep performance and UI audit probes
in those places instead of mixing them into ordinary feature folders. Closed
client-thinning and v1-v4 stability audits under `.archived-docs/` are
historical records, not test fixtures; current behavior is protected directly
by feature and performance regression tests.

Communication-cost regressions stay in the normal frontend/server lanes rather
than a separate package script. The server lane owns the large-corpus and
mutation-shape checks in `serverLoadCostHarness.test.ts`,
`commandMutationReadNarrowing.test.ts`, `commandSingleRowPaths.test.ts`,
`commandSettingsAndPluginStorageRange.test.ts`, and
`commandMessageFreeCeiling.test.ts`.

## Visible State Test Contract

This is policy guidance for choosing current Fastify tests, not a new gate. When
a change affects state the user can see, the rendered DOM is the primary oracle:
assert it after the same transition that changes state, or after the initial
render when state is seeded before mount. Prefer user-observable roles, names,
text, selection, and enabled/pressed state over component internals or source
text. Helper/state assertions, command payload assertions, store reads, and fetch
mocks can support classification, but they are not enough for stale-visible-UI
bugs. If behavior includes optimistic updates or rollback, assert both the
visible optimistic change and the visible rollback after settlement.

Use helper Vitest for pure helpers and resource-invalidation calculations,
Svelte DOM Vitest for state-to-DOM contracts, and sparse Fastify browser smoke
for end-to-end boot/API/SSE wiring. Add state-to-DOM coverage when touching
resource slice state, `selectedCharID`, `chatPage`, startup readiness,
authoritative resource applies, bootstrap/refresh/SSE, optimistic command
helpers, bridge
watchers, router selection, array create/delete/reorder flows, `$derived`,
`$effect`, keyed lists, memo signatures, or render dependency keys.

The two mounted audit probes
`src/lib/_audit/phase0Journey2TogglePaint.dom.test.ts` and
`src/lib/_audit/phase0Journey4Grouping.dom.test.ts` make DOM assertions before
using stores as classification aids. They run in `pnpm test:gates` and
`pnpm test:all`, not the default `pnpm test:frontend` lane. Use the same
DOM-first pattern in feature-owned component tests; reserve a new audit probe
for a cross-cutting invariant that needs an explicit gate.

Two named browser-smoke contracts protect reload/reconciliation behavior:
`server/fastify/browser-smoke/phase0VisibleState.spec.ts` covers chat-switch
repainting of the active generation preset, sidebar-toggle survival through
command/resource reconciliation, and route/sidebar continuity after an
old-lineage recovery reload.
`server/fastify/browser-smoke/rerollSwipePersistence.spec.ts` proves persisted
reroll alternates reconstruct after reload and remain swipe-recoverable. It uses
a direct generation request and the production swipe helper, so it proves
persistence/reconstruction rather than visible gesture controls.

## TypeScript And Formatting

- Root `tsconfig.json` is browser-oriented, `strict: false`, allows JS, and uses
  bundler resolution.
- `tsconfig.client-lib.json` emits declarations only into `dist/client-types`
  for server imports from client code; `tsconfig.node.json` covers
  `vite.config.ts`.
- `server/fastify/tsconfig.json` is strict, `noEmit: true`, and references
  `tsconfig.client-lib.json`.
- `tsconfig.browser-smoke.json` typechecks Playwright config/spec/helper sources
  in the same `pnpm check:server` lane.
- Prettier uses `prettier-plugin-svelte`, no semicolons, single quotes, and
  print width 120.
- `.prettierignore` excludes Markdown docs, `docs/`, archived docs, and agent
  handoff notes. `pnpm format` will not normalize these files, so keep docs
  tables and wrapping tidy by inspection.

Server TypeScript check workflow:

```sh
pnpm check:server
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

| Variable                                           | Default                    | Notes                                                                                                                                                     |
| -------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RISU_API_HOST`                                    | `0.0.0.0`                  | Fastify listen host.                                                                                                                                      |
| `RISU_API_PORT`                                    | `6002`                     | Fastify listen port.                                                                                                                                      |
| `RISU_API_DATA_DIR`                                | `<repo>/data`              | SQLite, asset bytes, backups, auth files, traces, and legacy import artifacts.                                                                            |
| `RISU_API_ALLOW_MISSING_DATABASE`                  | unset                      | Set to `1` only to accept creating a fresh `risu.db` when the data directory contains evidence of a prior installation.                                   |
| `RISU_API_BODY_LIMIT`                              | `104857600`                | JSON/body and multipart file limit.                                                                                                                       |
| `RISU_API_IMPORT_MAX_BYTES`                        | unlimited                  | Streamed device-backup import limit; positive byte count caps, `0`/`unlimited`/`none`/`infinity` opts out.                                                |
| `RISU_API_AUTOMATIC_BACKUP_RETENTION`              | `3`                        | Positive count of automatic pre-import/pre-restore safety snapshots to retain; manual backups are never pruned.                                           |
| `RISU_REALM_IMPORT_MAX_EXPANDED_BYTES`             | `325058560`                | Expanded payload cap for streamed Realm `charx` imports and Realm-fetched asset totals.                                                                   |
| `RISU_API_TRACE_MODE`                              | unset                      | Enables API request tracing when `agent` or `human`; `0`/`false`/`off`/`none` disable it.                                                                 |
| `RISU_GENERATION_TRACE_FULL_PROMPT`                | unset                      | Set to `1` with protocol metrics enabled to write redacted prompt-emission and OpenAI/Gemini request sidecars.                                             |
| `RISU_GENERATION_TRACE_FULL_PROMPT_MAX_GZIP_BYTES` | `10485760`                 | Maximum compressed size for prompt/provider and post-generation Lua trace sidecars.                                                                        |
| `RISU_WEB_PUSH_VAPID_PUBLIC_KEY`                   | unset                      | Optional Web Push VAPID public key. If both keys are omitted, the server can generate and persist keys under `<data-dir>/__web_push_vapid_keys.json`; supplying only one key disables Web Push. |
| `RISU_WEB_PUSH_VAPID_PRIVATE_KEY`                  | unset                      | Optional Web Push VAPID private key. Must be supplied with the public key when using env-provided keys.                                                   |
| `RISU_WEB_PUSH_CONTACT`                            | `mailto:risuai@example.invalid` | Web Push contact subject used for VAPID details.                                                                                                      |
| `TRUST_PROXY`                                      | `false`                    | Fastify trust proxy setting; accepts boolean, integer, or string.                                                                                         |
| `RISU_API_STATIC_ROOT`                             | `<repo>/dist`              | Static SPA root; empty, `none`, or `off` disables.                                                                                                        |
| `RISU_HUB_URL`                                     | `https://sv.risuai.xyz`    | Hub passthrough target.                                                                                                                                   |
| `RISU_REALM_URL`                                   | `https://realm.risuai.net` | Realm character import target.                                                                                                                            |
| `RISU_AGENT_DEV_AUTH_BYPASS`                       | disabled                   | Direct-server dev escape hatch; full-stack runners override it as described below.                                                                        |
| `LOG_LEVEL`                                        | `info`                     | Use `silent` to disable Fastify logger.                                                                                                                   |
| `RISU_PROTOCOL_METRICS`                            | unset                      | Enables structured protocol metrics and advertises v1 browser startup collection when `1`, `true`, `yes`, or `on`.                                        |

Local/dev:

| Variable                         | Default                                         | Notes                                                                                                                             |
| -------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `RISU_API_RESTART_FLAG`          | `.risu-api-restart`                             | Flag file watched by `pnpm api:dev:flag`.                                                                                         |
| `RISU_AGENT_DEV_HOST`            | `127.0.0.1`                                     | Host used by `pnpm dev:agent` / `pnpm dev:human` for both spawned processes.                                                      |
| `RISU_AGENT_DEV_PORT`            | `6418`                                          | Frontend port for `pnpm dev:agent`; `pnpm dev:human` sets it to `6002`.                                                           |
| `RISU_AGENT_API_PORT`            | `6419`                                          | Fastify port for `pnpm dev:agent`; `pnpm dev:human` sets it to `6001`.                                                            |
| `RISU_AGENT_DEV_AUTH_BYPASS`     | `TRUE` for `dev:agent`, `FALSE` for `dev:human` | Protected API routes ignore password auth when enabled.                                                                           |
| `RISU_AGENT_DATA_MODE`           | `clone`                                         | Agent sandbox reset policy: `clone` snapshots selected state from `data/`, `fresh` starts empty, and `keep` reuses `data-agent/`. |
| `RISU_TS_AGENT_TSSERVER_LOG`     | unset                                           | Set to `1` or a path to capture verbose `pnpm ts:agent` tsserver logs.                                                            |
| `RISU_TS_AGENT_TIMEOUT_MS`       | `30000`                                         | Default tsserver request timeout for `pnpm ts:agent`; `--timeout-ms` overrides it.                                                |
| `RISU_TS_AGENT_DEBUG`            | unset                                           | Echo tsserver stderr while debugging `pnpm ts:agent`.                                                                             |
| `TSS_LOG`                        | `-level off`                                    | Low-level tsserver log arguments forwarded by `pnpm ts:agent`; prefer `RISU_TS_AGENT_TSSERVER_LOG` for the supported file-logging workflow. |
| `VITE_RISU_AGENT_DEV_IGNORE_REALM_TERMS` | `TRUE` in full-stack runners                    | Set by `pnpm dev:agent` / `pnpm dev:human`; ordinary Vite/build leaves it unset. `alertRealmTerms()` returns accepted when set. |

Client/build:

| Variable                                                                         | Notes                                                                                                                   |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `RISU_API_PROXY_TARGET`                                                          | Vite dev proxy target for `/api`; defaults to `http://localhost:6002`.                                                   |
| `VITE_FASTIFY_BROWSER_SMOKE`                                                     | Enables browser smoke hook and fixed smoke password setup/login.                                                        |
| `VITE_RISU_LITE`                                                                 | Enables lite-mode consumers in settings/theme/legacy mobile code; does not mount `LiteMain` or the legacy mobile shell. |
| `VITE_AD_CLIENT`, `VITE_AD_CLIENT_MOBILE`, `VITE_AD_SLOT`, `VITE_AD_SLOT_MOBILE` | Ad UI configuration.                                                                                                    |

Test/audit summary variables include `RISU_TEST_INCLUDE_GATES`,
`UPDATE_FIXTURES`, `RISU_DIRECT_REALM_IMPORT_TEST`,
`RISU_COMMAND_METRIC_SUMMARY`,
`RISU_ASSET_BYTE_SUMMARY`, `RISU_EXPORT_MATERIALIZE_SUMMARY`, and
`RISU_GENERATION_METRIC_SUMMARY`.

## CI And Deployment

`.github/workflows/quality.yml` is the only current workflow. Pull requests and
pushes to `main` use Node 24 and pnpm 10. Formatting, both typecheck lanes,
frontend tests, isolated audit/performance gates, server tests, and serial
browser smoke run as independent jobs; only the smoke job installs Chromium.
The focused UI coverage job runs when `src/` or its runner/build configuration
changes and uploads its report. Playwright failure traces/results are also
uploaded. A final `verify` job preserves the aggregate pass/fail contract while
allowing independent lanes to finish after another lane fails. The local
`pnpm test:all` command remains the unconditional pre-merge equivalent.

The container path (`Dockerfile`, `docker-compose.yml`, `.dockerignore`) was
removed on 2026-07-22; the project does not currently ship a Docker image, and
running from source is the only supported deployment.
