# Testing And Operations

Last audited: 2026-08-30.

Use `pnpm` for package scripts. Node.js is declared as `>=24.0.0`. The package
is root-only; there is no `server/fastify/package.json`. `package.json` pins
`pnpm@11.23.0`, and the lockfile is pnpm lockfile v9. Local servers, tracing,
startup telemetry/measurement, built-SPA serving, browser support, and runtime
environment variables live in
[Development And Observability](development-and-observability.md).

The
[Frontend Test Architecture record](../../.archived-docs/performance-and-stability/frontend-test-architecture/status.md)
explains the rollout and benchmarks behind the settled frontend project
ownership. This document and the current runner configuration are the source of
truth for the resulting commands, routing, setup, and lane behavior.

The completed
[Test Suite Effectiveness Audit](../../.archived-docs/performance-and-stability/test-suite-effectiveness-audit/status.md)
is historical. Its retained manifests are frozen records rather than live gates;
current commands and behavior stay authoritative here.

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
| `pnpm check:watch`                 | Keep the same Svelte project warm, rerun incremental diagnostics after source edits, and emit machine-readable cycles for `test:watch`.                                      |
| `pnpm check:server`                | Check protocol types, emit client-library declarations, then typecheck strict Fastify and Playwright browser-smoke projects concurrently without emitting server code.        |
| `pnpm test`                        | Alias for `pnpm test:frontend`; runs the default root/browser Vitest lane, including UI audit probes but excluding explicit performance gates.                                |
| `pnpm test:quick`, `pnpm test:affected` | Run changed test files directly or use Vitest dependency selection for changed source files; defaults to the uncommitted diff against `HEAD`.                            |
| `pnpm test:watch:agent`            | Supervise the worktree watcher, keep Svelte diagnostics and ordinary frontend/server Vitest contexts warm, restart failed workers, and publish ignored status/log artifacts under `.test-watch/`. |
| `pnpm test:watch:await`            | Wait for the supervised watcher to finish the exact current worktree; exits `0` for pass, `1` for failure, `2` while still pending at the timeout, and `3` when unavailable. |
| `pnpm test:watch:status`           | Show the non-blocking supervised-worker health and exact-fingerprint result with the same `0`/`1`/`2`/`3` outcome classes. |
| `pnpm test:frontend`               | Run default root/browser Vitest tests outside `server/**`, excluding explicit performance gates.                                                                              |
| `pnpm test:frontend:all`           | Run all root/browser Vitest tests, including explicit performance gates.                                                                                                       |
| `pnpm test:gates`                  | Run the UI-audit and explicit performance gates together; UI-audit coverage is also present in `test:frontend`.                                                              |
| `pnpm test:gates:audit`            | Run only the UI-audit tests for focused debugging; they are already part of `test:frontend`.                                                                                  |
| `pnpm test:gates:perf`             | Run render-cost and clone-count gates.                                                                                                                                        |
| `pnpm test:server`                 | Run Fastify/server Vitest tests.                                                                                                                                              |
| `pnpm test:server:realm-scale`     | Run the isolated 7,000-asset Realm import capacity case with one worker.                                                                                                      |
| `pnpm validate:compat-registers`   | Validate the compatibility inventory/findings schemas, cross-register references, and pinned upstream commit coverage.                                                       |
| `pnpm test:compat-current`         | Check the 16 current-stack golden matrix cells and two cluster regressions without requiring the external baseline worktree.                                                  |
| `pnpm test:compat-harness`         | Compare pinned local/Fastify generation matrices against a prepared pre-Fastify worktree; opt-in and not part of `test:all`.                                                 |
| `pnpm prepare:compat-baseline`     | Create or verify the exact detached compatibility-baseline worktree and install its frozen dependencies.                                                                       |
| `pnpm test:smoke`                  | Alias for `pnpm smoke:fastify-browser`.                                                                                                                                       |
| `pnpm test:all`                    | Run format, Svelte, strict server/browser-smoke TypeScript, frontend tests, compatibility register/current checks, isolated performance gates, the UI coverage gate, server tests, and browser smoke with bounded concurrency; preserve every failing lane. |
| `pnpm coverage:ui-map`             | Run the focused UI coverage gate and write text/JSON reports to `coverage/ui-map`; use `coverage:ui-map:html` for an on-demand HTML report.                                   |
| `pnpm api:test`                    | Compatibility alias for `pnpm test:server`.                                                                                                                                   |
| `pnpm smoke:fastify-browser`       | Build the smoke client without production sourcemaps, then run Playwright Fastify browser smoke.                                                                             |
| `pnpm analyze:db <path>`           | Analyze `.risu`, JSON, raw database JSON, or data dirs containing `db.json`; SQLite sidecars are copied when present. Add `--json` for machine-readable output.               |
| `pnpm ts:agent <command>`          | Run the tsserver-backed agent debugging wrapper for navigation, diagnostics, symbols, code actions, imports, and renames.                                                     |
| `pnpm format`, `pnpm format:check` | Prettier write/check.                                                                                                                                                         |
| `pnpm coverage:frontend`           | Run root/browser Vitest tests with broad frontend coverage under `coverage/frontend`.                                                                                          |
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
| Realm import scale gate     | `pnpm test:server:realm-scale`, `server/fastify/vitest.config.ts`                       | Node        | The direct-only 7,000-display-asset Realm/CharX import case; isolated in local aggregate and CI.                           |
| Compatibility harness      | `pnpm test:compat-current`, `pnpm test:compat-harness`, `test/compat-harness/*.vitest.config.ts` | Node | Current-stack/cluster goldens run in `test:all`; the full pinned baseline differential requires its prepared worktree and remains separate. |
| Backend coverage            | `pnpm coverage:backend`, `server/fastify/vitest.config.ts`                              | Node        | Broad coverage over `server/fastify/src/**/*.ts`; reports under `coverage/backend`.                                        |
| Browser smoke               | `pnpm smoke:fastify-browser` or `pnpm test:smoke`, `playwright.fastify-smoke.config.ts` | Chromium    | `server/fastify/browser-smoke/`; specs start an in-process Fastify app on a random port serving `dist`.                    |

Pick the smallest command that covers the changed area. `pnpm test:affected`
uses exact paths when only tests changed and dependency-aware `--changed`
selection when source changed. `--base <git-ref>` selects a branch diff,
`--dry-run` prints the plan, `--include-smoke` opts into relevant Playwright
work, and `--all` selects `test:all`. Deleted tests/source and runner changes
conservatively widen to their complete lanes. Aggregate/affected runner and CI
changes widen to `test:all`. A protocol-package manifest change stays targeted
only when it adds explicit subpath exports to existing local `src/*.ts` files
without changing or removing an existing export or another package field; every
other manifest edit fails closed to `test:all`. Batch related additive exports
and run the aggregate once at the integration boundary. On a fresh machine, run
`pnpm exec playwright install --with-deps chromium` before browser smoke.
`server/fastify/__tests__/README.md` is the maintained topical map for the flat
Fastify test directory; use it to find command/persistence, generation, memory,
provider, job, asset/import, and platform/route coverage.

### Background Svelte-check and affected-test watcher

Run `pnpm test:watch:agent` in the task's integrated terminal to move the
Svelte-check and affected-test feedback loops into a persistent process. It
debounces edit bursts, captures the complete Git diff plus untracked files,
hashes the contents and metadata of every changed path, and builds the same plan
as `pnpm test:affected`. The first compatible affected scope runs as a full
baseline. After it passes, the watcher compares per-path fingerprints with that
passing snapshot and executes only the latest compatible delta while retaining
the full affected scope as the reported coverage. Modified tests rerun directly;
new test files are registered with their matching Vitest project and run
directly; modified source files use dependency-aware selection. Source additions,
deletions, renames, HEAD changes, and affected-lane shape changes fall back to a
new full baseline. A failed generation cannot seed an incremental test run.

The watcher starts the Svelte-check process exposed as `pnpm check:watch` once
and treats each completed diagnostic cycle as the frontend-check command.
Svelte-check retains its language-service state, so the initial project
diagnostic pass is full while later source edits reuse the warm TypeScript/Svelte
program. A relevant edit invalidates an older cycle; diagnostics that finish
after another edit are discarded until a cycle for the newest source version
completes. Warnings remain visible but preserve the ordinary `pnpm check` exit
policy: only errors fail the command. Source additions, deletions, and renames
conservatively recycle the warm process after the edit debounce so newly imported
modules cannot retain a transient pre-save snapshot. Changes outside the root
Svelte project otherwise reuse its latest diagnostic cycle; imported JSON and
checker-configuration edits also recycle the warm process before publishing a
new result.

Ordinary direct/dependency-aware frontend and server runs reuse long-lived
Vitest/Vite contexts, including their test-file discovery caches. Changed test
specifications are invalidated individually, and all changed modules are
invalidated in both the host module graph and reused worker pools. Protocol,
performance, browser-smoke, compatibility, Realm-scale, and full-quality
commands retain their package-script process and environment behavior.
Full-lane runs recreate their warm context first so deleted files or runner
changes cannot use an old module graph.

The lightweight supervisor owns the exclusive worktree lock, independent
heartbeat, and worker restart loop. The worker eagerly starts Svelte-check and
initializes both ordinary Vitest contexts in the background at startup without
executing tests.
Vitest's standalone initialization populates each context's test-discovery
cache, so a clean initial generation can use idle startup time to prepare all
three warm lanes before the first edit. A context that fails to warm logs the
failure and retries initialization when its lane is selected. A context whose
Vitest/Vite execution throws is discarded and recreated before that lane runs
again. Unexpected worker exits are restarted with bounded backoff and a fresh
full baseline. A worker whose coordinator heartbeat makes no progress for five
minutes is replaced as wedged; repeated rapid exits eventually publish an
unavailable supervisor rather than looping forever. The diagnostic `--once`
mode skips the supervisor and eager warm-up and starts Svelte-check when its
command runs.

The supervisor writes `.test-watch/supervisor.json`; the worker writes
`.test-watch/status.json` atomically and streams the latest generation to both
the terminal and `.test-watch/latest.log`. A relevant filesystem event during
execution leaves the active generation visibly running and records that a rerun
is pending. A run is published as `passed` or `failed` only when a second
worktree fingerprint taken after the commands exactly matches the fingerprint
taken before them; otherwise the result is discarded and the queued generation
runs. The status includes the worker PID/heartbeat, supervisor identity, base
ref, generation, target, tested, and targeted-feedback fingerprints, full
affected commands, actually executed commands, execution mode and changed
paths, queued-rerun state, any reused tested fingerprint, notes, per-command
results, timings, and any deferred quality commands. Status validation trusts
the independent supervisor heartbeat while the embedded test worker is busy, so
a long in-process transform or test cannot make active work appear abandoned.

When build, dependency, aggregate-runner, or CI configuration changes make the
final targeted selection unsafe, the watcher records `test:all` as the deferred
authoritative gate but still runs warm Svelte diagnostics and safe affected
feedback for non-configuration paths. A matching feedback pass is published as
`waiting-for-commit` with a separate feedback fingerprint; it never populates
the authoritative tested fingerprint. Further edits on the same `HEAD` rerun
only that safe feedback. After the coherent configuration batch is committed
and the worktree is clean, the watcher runs the deferred `test:all` once for the
new commit. The deferred command and originating `HEAD` are stored in status so
a supervised worker restart cannot silently lose the requirement.

Use `pnpm test:watch:await` as the handoff trust boundary. It independently
fingerprints the current worktree, validates the supervisor lease, and follows
queued or recovering work until the exact fingerprint completes. Use
`pnpm test:watch:status` for an immediate diagnostic snapshot. Their exit
statuses mean:

- `0`: the watched Svelte-check and affected plan passed for the exact current
  worktree. This may replace redundant `pnpm check` and `pnpm test:affected`
  runs with the same watcher options.
- `1`: the watched affected plan failed for the exact current worktree. Read
  `.test-watch/latest.log`; rerunning is needed only for additional diagnostics.
- `2`: work is starting, running, queued, recovering, waiting for a commit,
  still pending at timeout, or targeted feedback passed while a final full gate
  remains. `test:watch:await` returns immediately for the latter case: commit
  the completed batch so the watcher can run the deferred aggregate. Do not
  start a duplicate while a command is active.
- `3`: the supervisor is missing, stopped, incompatible, stale, or exhausted its
  automatic recovery. Restart `test:watch:agent` or use the normal command.

Raw status JSON is not sufficient evidence. A watched pass replaces `pnpm check`
and only the affected plan it records; browser-smoke/compatibility notes and
broader owning lane or final-handoff requirements still apply. Pass
`--base <git-ref>` to use a branch base and pass that same base to the await or
status command. Use
`--debounce-ms <ms>` to tune coalescing, or `--include-smoke` to let relevant
browser changes trigger the smoke lane automatically; pass `--include-smoke` to
the await or status command when smoke coverage is required. `--timeout-ms`
changes the default ten-minute await bound. Stop the watcher when the task is
complete.

`pnpm validate:compat-registers` and `pnpm test:compat-current` are ordinary
quality owners. The current harness validates current-stack and cluster goldens
without external prerequisites. The full compatibility harness additionally
requires the pinned baseline worktree and its dependencies prepared by
`pnpm prepare:compat-baseline`; it remains outside `pnpm test:all` because that
external worktree is not a normal checkout prerequisite. The preparer defaults
to the sibling `../risu-baseline-71c476e9c` path; set
`RISU_COMPAT_BASELINE_ROOT` to an absolute path when a runner needs another
location. Preparation and harness execution resolve the same override.

Compatibility fixtures and goldens are evidence, not permission to change
behavior. Run the full harness normally first and review its retained semantic
artifacts. For an intentional adjudicated change, use
`pnpm test:compat-harness -- --update-goldens --reason "<review reason>"`; the
full pinned lane and a nontrivial reason are mandatory, and current-only runs
cannot update goldens. The command refreshes the tracked
`test/compat-harness/golden/{baseline,current,diff,cluster10}.json` files and
their digest manifest only after governance validation passes.

Review all four golden artifacts together. The computed `diff.json` is checked
against `test/compat-harness/expected-differences.json`, whose cell/aspect
digests, rationale, signed decision IDs, and inventory IDs are validated against
the compatibility registers. A new, removed, or changed divergence fails until
that mapping is adjudicated. A normalizer change also needs focused positive and
negative cases showing that meaningful request, execution, or transcript
differences remain visible.

Compatibility fixture provenance is tracked in
`test/compat-harness/fixture-provenance.json`. The harness validates its pinned
baseline commit, ordered cases, normalization contract, source paths, and source
digests on every run; the governed full update command refreshes those source
digests before writing the golden manifest. There is no separate compatibility
fixture-update environment switch.

Each harness run writes `actual-*.json` under the ignored
`fast-bootstrap-results/compat-harness/` directory. Compare those files with the
tracked goldens and classify a failure as baseline preparation, provenance or
governance validation, unexpected current behavior, or an intentional
expected-difference change before updating anything. PR/main current-harness
failures upload available diagnostics for 14 days. The scheduled/manual full
workflow always uploads the preparation/run logs that were produced, actual
artifacts, tracked comparison goldens and manifest, expected-difference map, and
fixture provenance for 14 days. If a review outlives that window, preserve the
relevant diff and rationale in the tracked change rather than relying on an
expiring workflow artifact.

Affected selection and aggregate ownership are deliberately different.
`pnpm test:affected` routes compatibility register JSON or validator changes to
register validation, compatibility production changes to the current harness,
and harness/baseline infrastructure changes to both current and full pinned
harnesses. `pnpm test:all` owns register validation and current compatibility,
but not the full pinned differential. A targeted or aggregate pass therefore
does not replace a full differential when the harness/baseline itself changes
or when compatibility risk calls for baseline comparison.

`pnpm test:all` runs up to two ordinary lanes concurrently by default and
preserves any failure in the final aggregate result. Set
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
Pass `--timings=json` to append a schema-versioned JSON record containing the
aggregate duration, configured job limit, and each lane's elapsed time plus
start/finish offsets, dependency metadata, isolation flag, and exit code. This
is observational only and is intended to expose the real critical path before
changing concurrency or isolation.

Use focused tests or the watcher during an edit batch, then one complete owning
lane or one `test:all` at the batch boundary. Do not stack `check:protocol`,
`check:server`, `check`, component lanes, and `test:all` as independent handoff
steps: `check:server` already owns the protocol check, while `test:all` owns both
check families and every local aggregate lane. Repeat a component only when it
is needed to diagnose a failure.

Config details: `vitest.config.ts` composes three isolated thread-pool projects,
and `vitest.frontend-routing.ts` owns their disjoint filename/registration
contract. Plain `*.test.ts` files default to Node; `*.svelte-node.test.ts` uses
client-mode Svelte transformation against Node globals; `.svelte.test.ts` and
`.dom.test.ts` use Svelte/Happy-DOM. The DOM project also positively includes
187 reviewed pre-suffix owners whose Phase 3-5 probes proved transitive browser
requirements. This registration avoids rename-only churn; there is no
unclassified-to-DOM fallback. The Svelte+Node custom environment
delegates to Vitest's Node setup while selecting Vite's client transform so
`$effect` retains client semantics.

All three projects retain browser resolve conditions, the `src` alias, and
`vitest.setup.ts` to install the shared production `safeStructuredClone` helper
and establish an explicit all-ready startup baseline. Real KaTeX remains
available to parser tests; behavior libraries require scoped, faithful mocks
when a test needs isolation. Only the two Svelte projects load the Svelte plugin,
and only the DOM project loads `vitest.dom.setup.ts`. That DOM-only setup blocks
unexpected fetches resolving to loopback port `3000` and reports the originating stack;
tests that perform network-shaped work must stub `fetch` explicitly and await
fire-and-forget command drains before teardown. `vitest.setup.test.ts` protects
the shared native, fallback, global-restoration, and exact post-startup
capability semantics, while
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
`realmImport.test.ts` enables its otherwise skipped 7,000-asset stress case.
`test:server:realm-scale`, `test:all`, and CI own that selection as an isolated
single-worker gate.

`pnpm coverage:frontend` and `pnpm coverage:backend` are broad coverage views for
reporting and enforce no thresholds. `pnpm coverage:all` runs both sides and still executes backend
coverage when frontend tests fail, then exits non-zero if either side failed.

`pnpm coverage:ui-map` is the focused UI state coverage gate included in
`pnpm test:all`. It uses `@vitest/coverage-v8`, runs the focused ChatScreens,
Others, and SideBars UI test files, enforces line `8%`, statement `7%`, function
`5%`, and branch `4%` thresholds, and emits `text` and `json-summary` reports
under `coverage/ui-map`. Its denominator excludes the exact test-only UI hosts,
stubs, and harnesses listed in `vitest.ui-coverage-tests.ts`. `pnpm coverage:ui-map:html`
additionally emits HTML on demand. The repository ignores `coverage/`; keep all
coverage reports local unless a plan slice explicitly asks for extracted
results.

Browser smoke also owns tracked desktop/mobile screenshot baselines under
`server/fastify/browser-smoke/*-snapshots/`. The core-chat and blocking-alert
assertions are part of `pnpm test:smoke`, so update those PNGs only for an
intentional visible change.

Smoke mode keeps the built SPA, resource/command protocol, Fastify, SQLite, and
Chromium journeys real, but makes selected surroundings deterministic. It uses
test auth and observer controls, shortens a finalization refresh, and disables
unrelated provider, worker, and asset-GC activity. Treat its assertions as
cross-layer startup, recovery, navigation, command, and durability evidence;
they do not prove the live auth UI, external providers, production refresh
timing, memory workers, or asset garbage collection.

Prompt/generation fixtures live in `src/ts/process/__fixtures__/`; review any
expected fixture change with its owning tests. Server `.risu` fixture helpers
live in `server/fastify/__fixtures__/risuSave/`. Explicit performance gates live
in `src/ts/__tests__/`, while cross-cutting UI audit probes live in
`src/lib/_audit/` and run in the ordinary frontend lane. Keep those specialized
probes in their current locations instead of mixing them into feature folders.
Fastify suites that need an assembled read-after-write snapshot call
`injectComposedResourceDatabase` explicitly. The helper composes settings,
collections, and character resources for the requesting test only; it does not
patch production bootstrap behavior. Production `/api/v1/bootstrap` remains
runtime-only and has no legacy `database` property. New tests should use the
narrow resource reader unless composed state is the behavior under test.
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

`server/fastify/browser-smoke/bardWikiLifecycle.spec.ts` protects the visible
BardWiki settings and provider-cost warning, active-chat workspace, manual
document creation, explicit current-turn confirmation/job state, lifecycle and
vault warnings, and persistence through reload. Repository/route/component
tests retain the destructive, conflict, restart, and privacy edge cases that do
not belong in a browser journey.

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

`.github/workflows/quality.yml` runs for pull requests and pushes to `main` with
Node 24 and the exact pnpm version declared by `packageManager` in
`package.json`. Formatting, both typecheck lanes, frontend tests (including UI
audit probes), focused UI coverage, isolated performance gates, compatibility
register validation, current compatibility, server tests, and serial browser
smoke run as separate jobs; only the smoke job installs Chromium. Current
compatibility waits for register validation, and both results are required by
the final `verify` aggregate. The ordinary frontend job always omits the six
sentinel files because the unconditional coverage job executes them once with
the same assertions and additional thresholds, then uploads its report.
Playwright failure traces/results are also uploaded. The final `verify` job
preserves the aggregate pass/fail contract while allowing independent lanes to
finish after another lane fails. Local `pnpm test:all` has the same test
ownership with bounded concurrency and isolated load-sensitive phases; CI
additionally runs the initial-preload build/report lane.

`.github/workflows/compatibility-differential.yml` runs the full pinned
differential nightly at 06:00 UTC and on manual dispatch. It fetches full Git
history, prepares and rechecks the exact detached baseline, and runs
`pnpm test:compat-harness` with read-only repository permissions, one shared
non-cancelling concurrency group, and a 60-minute job timeout. Its retained
artifact is the first triage source described above; preparation and harness
failures still reach the `if: always()` upload step.

The container path (`Dockerfile`, `docker-compose.yml`, `.dockerignore`) was
removed on 2026-07-22; the project does not currently ship a Docker image, and
running from source is the only supported deployment. There is no separate
release workflow or packaged release channel in this repository. Consequently,
the `main` Quality result plus a successful full differential for the candidate
commit are the release-equivalent gates for source builds. The scheduled run
usually supplies the full evidence for `main`; manually dispatch it at the
candidate ref when the scheduled result does not cover that exact commit.
