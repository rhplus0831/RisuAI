# Testing And Operations

Last audited: 2026-08-28.

Use `pnpm` for package scripts. Node.js is declared as `>=24.0.0`. The package
is root-only; there is no `server/fastify/package.json`. `package.json` does not
pin a `packageManager`; the lockfile is pnpm lockfile v9. Local servers, tracing,
startup telemetry/measurement, built-SPA serving, browser support, and runtime
environment variables live in
[Development And Observability](development-and-observability.md).

The active
[Frontend Test Architecture plan](../plan/frontend-test-architecture/status.md)
tracks the phased rollout of frontend project ownership. This document and the
current runner configuration describe the phases that have landed.

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
| `pnpm check:server`                | Check protocol types, emit client-library declarations, then typecheck strict Fastify and Playwright browser-smoke projects concurrently without emitting server code.        |
| `pnpm test`                        | Alias for `pnpm test:frontend`; runs the default root/browser Vitest lane, including UI audit probes but excluding explicit performance gates.                                |
| `pnpm test:quick`, `pnpm test:affected` | Run changed test files directly or use Vitest dependency selection for changed source files; defaults to the uncommitted diff against `HEAD`.                            |
| `pnpm check:frontend-test-inventory`, `pnpm update:frontend-test-inventory` | Verify or intentionally regenerate the final exhaustive/disjoint frontend capability manifest and routing registrations. |
| `pnpm test:frontend`               | Check frontend routing, then run default root/browser Vitest tests outside `server/**`, excluding explicit performance gates.                                                  |
| `pnpm test:frontend:all`           | Check frontend routing, then run all root/browser Vitest tests, including explicit performance gates.                                                                         |
| `pnpm test:gates`                  | Run the UI-audit and explicit performance gates together; UI-audit coverage is also present in `test:frontend`.                                                              |
| `pnpm test:gates:audit`            | Run only the UI-audit tests for focused debugging; they are already part of `test:frontend`.                                                                                  |
| `pnpm test:gates:perf`             | Run render-cost and clone-count gates.                                                                                                                                        |
| `pnpm test:server`                 | Run Fastify/server Vitest tests.                                                                                                                                              |
| `pnpm test:compat-harness`         | Compare pinned local/Fastify generation matrices against a prepared pre-Fastify worktree; opt-in and not part of `test:all`.                                                 |
| `pnpm test:smoke`                  | Alias for `pnpm smoke:fastify-browser`.                                                                                                                                       |
| `pnpm test:all`                    | Run format, Svelte, strict server/browser-smoke TypeScript, frontend tests, isolated performance gates, the UI coverage gate, server tests, and browser smoke with bounded concurrency; preserve every failing lane. |
| `pnpm coverage:ui-map`             | Run the focused UI coverage gate and write text/JSON reports to `coverage/ui-map`; use `coverage:ui-map:html` for an on-demand HTML report.                                   |
| `pnpm api:test`                    | Compatibility alias for `pnpm test:server`.                                                                                                                                   |
| `pnpm smoke:fastify-browser`       | Build the smoke client without production sourcemaps, then run Playwright Fastify browser smoke.                                                                             |
| `pnpm analyze:db <path>`           | Analyze `.risu`, JSON, raw database JSON, or data dirs containing `db.json`; SQLite sidecars are copied when present. Add `--json` for machine-readable output.               |
| `pnpm ts:agent <command>`          | Run the tsserver-backed agent debugging wrapper for navigation, diagnostics, symbols, code actions, imports, and renames.                                                     |
| `pnpm format`, `pnpm format:check` | Prettier write/check.                                                                                                                                                         |
| `pnpm coverage:frontend`           | Check frontend routing, then run root/browser Vitest tests with broad frontend coverage under `coverage/frontend`.                                                            |
| `pnpm coverage:backend`            | Run Fastify/server Vitest tests with broad backend coverage under `coverage/backend`.                                                                                         |
| `pnpm coverage:all`                | Run frontend and backend coverage, preserving a failing exit code if either side fails.                                                                                       |

There is no ESLint config or `lint` script.

## Tests And Checks

| Area                        | Command/config                                                                          | Environment | Locations                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- |
| Browser/client/domain tests | `pnpm test` or `pnpm test:frontend`, `vitest*.config.ts`                                | Node + Svelte/Node + `happy-dom` | Root suite outside `server/**`, including `src/**`, `util/**/*.test.ts`, and `src/lib/_audit`, minus performance gates. |
| Specialized frontend gates  | `pnpm test:gates`, `vitest.config.ts`                                                   | Node + `happy-dom` | Exact performance owners plus `src/lib/_audit/**/*.test.ts`.                                                        |
| Focused UI audit tests      | `pnpm test:gates:audit`, `vitest.config.ts`                                             | Node + `happy-dom` | `src/lib/_audit/**/*.test.ts`; also included in the ordinary frontend lane.                                         |
| Full frontend tests         | `pnpm test:frontend:all`, `vitest.config.ts`                                            | Node + Svelte/Node + `happy-dom` | Root suite outside `server/**`, including explicit performance gates.                                             |
| Frontend coverage           | `pnpm coverage:frontend`, `vitest.config.ts`                                            | Node + Svelte/Node + `happy-dom` | Broad coverage over `src/**/*.{ts,svelte}` and `util/**/*.ts`; reports under `coverage/frontend`.                 |
| UI coverage map             | `pnpm coverage:ui-map`, `vitest.config.ts`                                              | Node + `happy-dom` | Six focused tests mapped over `src/lib/ChatScreens`, `src/lib/Others`, `src/lib/SideBars`, and `src/ts/server`.     |
| Fastify/server tests        | `pnpm test:server` or `pnpm api:test`, `server/fastify/vitest.config.ts`                | Node        | `server/fastify/__tests__/**/*.test.ts`.                                                                                   |
| Compatibility harness      | `pnpm test:compat-harness`, `test/compat-harness/*.vitest.config.ts`                    | Node        | Golden pre-Fastify/current generation matrix plus focused replay/continue regressions; opt-in and outside `test:all`.      |
| Backend coverage            | `pnpm coverage:backend`, `server/fastify/vitest.config.ts`                              | Node        | Broad coverage over `server/fastify/src/**/*.ts`; reports under `coverage/backend`.                                        |
| Browser smoke               | `pnpm smoke:fastify-browser` or `pnpm test:smoke`, `playwright.fastify-smoke.config.ts` | Chromium    | `server/fastify/browser-smoke/`; specs start an in-process Fastify app on a random port serving `dist`.                    |

Pick the smallest command that covers the changed area. `pnpm test:affected`
uses exact paths when only tests changed and dependency-aware `--changed`
selection when source changed. `--base <git-ref>` selects a branch diff,
`--dry-run` prints the plan, `--include-smoke` opts into relevant Playwright
work, and `--all` selects `test:all`. Deleted tests/source and runner changes
conservatively widen to their complete lanes. Frontend plans run the routing
gate before direct or dependency-aware execution; aggregate/affected runner and
CI changes widen to `test:all`. On a fresh machine, run
`pnpm exec playwright install --with-deps chromium` before browser smoke.
`server/fastify/__tests__/README.md` is the maintained topical map for the flat
Fastify test directory; use it to find command/persistence, generation, memory,
provider, job, asset/import, and platform/route coverage.

The compatibility harness requires the pinned baseline worktree and its
dependencies at the path declared in `test/compat-harness/run.ts`. Set
`UPDATE_COMPAT_HARNESS=1` only when intentionally refreshing its tracked golden
artifacts. It is excluded from `pnpm test:all` because that external worktree is
not a normal checkout prerequisite.

`pnpm test:all` runs up to two ordinary lanes concurrently by default. Its
explicit routing lane independently verifies ownership while the other regular
checks continue, and any failure is preserved in the final aggregate result. Set
`RISU_TEST_ALL_JOBS` or pass `--jobs <count>` to tune that outer limit, and use
`--dry-run` to inspect the lane graph. Browser smoke runs outside that pool and
waits for `check:server` because declaration checking and the smoke build both
use `dist/`; its stateful tests remain serial within each spec while two locally
isolated spec files may run concurrently. The focused UI coverage lane waits
for `test:frontend` and owns its six sentinel files during `test:all`, so the
ordinary frontend subprocess does not execute them twice. The render/clone
performance gates run with one Vitest worker and no file parallelism. The
Fastify/server lane also runs outside the concurrent pool because it contains
deadline and load-cost assertions. These isolated phases keep concurrent load
from invalidating timing checks. Every lane still runs when another lane fails,
and the aggregate exits nonzero at the end.

Config details: `vitest.config.ts` composes three isolated thread-pool projects,
and `vitest.frontend-routing.ts` owns their disjoint filename/registration
contract. Plain `*.test.ts` files default to Node; `*.svelte-node.test.ts` uses
client-mode Svelte transformation against Node globals; `.svelte.test.ts` and
`.dom.test.ts` use Svelte/Happy-DOM. The DOM project also positively includes
187 reviewed pre-suffix owners whose Phase 3-5 probes proved transitive browser
requirements. This registration avoids rename-only churn and is stale-checked;
there is no unclassified-to-DOM fallback. The Svelte+Node custom environment
delegates to Vitest's Node setup while selecting Vite's client transform so
`$effect` retains client semantics.

All three projects retain browser resolve conditions, the `src` alias, and
`vitest.setup.ts` to mock `katex`, install the shared production
`safeStructuredClone` helper, and establish the default startup-readiness
baseline. Only the two Svelte projects load the Svelte plugin, and only the DOM
project loads `vitest.dom.setup.ts`. That DOM-only setup blocks unexpected
fetches resolving to loopback port `3000` and reports the originating stack;
tests that perform network-shaped work must stub `fetch` explicitly and await
fire-and-forget command drains before teardown. `vitest.setup.test.ts` protects
the shared native, fallback, and global-restoration semantics, while
`vitest.fetchGuard.test.ts` protects the DOM fetch boundary. Root Vitest excludes
explicit performance gate tests unless
`RISU_TEST_INCLUDE_GATES=true` is set. `test:all` also sets
`RISU_TEST_EXCLUDE_UI_MAP=true` only for its ordinary frontend subprocess; the
following coverage lane executes those same six files once with instrumentation
and thresholds. Standalone `test:frontend` continues to include them.
`pnpm test:gates`, `pnpm test:gates:perf`, `pnpm test:frontend:all`, and
`pnpm coverage:frontend` set that variable for the lanes that intentionally
include those performance files. The audit-focused command selects its files
directly and needs no gate environment. Server Vitest uses Node, forks, a 15s
test timeout, and
sets `RISU_DIRECT_REALM_IMPORT_TEST` only when the Realm import test is directly
selected. Playwright smoke keeps tests within each file serial; local runs use
two file workers, while CI stays at one worker. It retains Chromium traces on
failure and rejects focused tests when CI is truthy.
The frontend and server Vitest configs set `allowOnly: false`. Directly selecting
`realmImport.test.ts` also enables its otherwise skipped 7,000-asset stress case.

`pnpm check:frontend-test-inventory` compares independent filesystem discovery
with resolved Vitest project discovery for the full, standalone ordinary, and
`test:all` ordinary views. It rejects unclassified names, missing, multiply
assigned, unexpected, filename/project-mismatched, duplicate/stale/redundant
registration, and stale manifest entries, and tracks browser-smoke specs
separately. It also rejects statically reliable DOM-only imports in N/S files
with an actionable rename or
`// @frontend-test-capability-override: <reviewed reason>` path for legitimate
dependency-injected tests. Static signals supplement execution proof and never
silently move a file. Use `pnpm update:frontend-test-inventory` only for an
intentional reviewed refresh.

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
live in `server/fastify/__fixtures__/risuSave/`. Explicit performance gates live
in `src/ts/__tests__/`, while cross-cutting UI audit probes live in
`src/lib/_audit/` and run in the ordinary frontend lane. Keep those specialized
probes in their current locations instead of mixing them into feature folders.
Closed
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

The mounted audit probe `src/lib/_audit/optimisticTogglePaint.dom.test.ts`
asserts optimistic and grouped toggle rendering before using stores as
classification aids. It runs in the default
`pnpm test:frontend` lane and `pnpm test:all`; `pnpm test:gates:audit` selects
that file for focused debugging. Use the same DOM-first pattern in
feature-owned component tests; reserve a new audit probe for a cross-cutting
invariant that benefits from a dedicated audit location.

Two named browser-smoke contracts protect reload/reconciliation behavior:
`server/fastify/browser-smoke/visibleStateRecovery.spec.ts` covers chat-switch
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
- `packages/protocol/tsconfig.json` strictly checks the browser-safe shared wire
  schemas. `pnpm check:protocol` runs it directly and `pnpm check:server` includes
  it before the client-library and Fastify checks.
- `tsconfig.client-lib.json` emits declarations only into `dist/client-types`
  for server imports from client code; `tsconfig.node.json` covers
  `vite.config.ts`.
- `server/fastify/tsconfig.json` is strict, `noEmit: true`, and references
  `tsconfig.client-lib.json`.
- `tsconfig.browser-smoke.json` typechecks Playwright config/spec/helper sources
  in the same `pnpm check:server` lane. After the protocol and declaration
  prerequisites pass, the Fastify and browser-smoke checks run concurrently.
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
imports. Protocol package changes are source-exported and checked through both
the dedicated protocol project and their client/server consumers.

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

## CI And Deployment

`.github/workflows/quality.yml` is the only current workflow. Pull requests and
pushes to `main` use Node 24 and pnpm 10. Formatting, both typecheck lanes,
frontend routing, frontend tests (including UI audit probes), focused UI
coverage, isolated performance gates, server tests, and serial browser smoke run
as independent jobs; only the smoke job installs Chromium. The ordinary
frontend job always omits the six sentinel files because the unconditional
coverage job executes them once with the same assertions and additional
thresholds, then uploads its report. Playwright failure traces/results are also
uploaded. A final `verify` job preserves the aggregate pass/fail contract while
allowing independent lanes to finish after another lane fails. Local
`pnpm test:all` has the same test ownership with bounded concurrency and
isolated load-sensitive phases; CI additionally runs the initial-preload
build/report lane.

The container path (`Dockerfile`, `docker-compose.yml`, `.dockerignore`) was
removed on 2026-07-22; the project does not currently ship a Docker image, and
running from source is the only supported deployment.
