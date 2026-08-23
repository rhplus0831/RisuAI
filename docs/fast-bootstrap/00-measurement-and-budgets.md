# Phase 0: Measurement and Budgets

## Outcome

Create a reproducible baseline for navigation-to-readiness, initial JavaScript,
and bootstrap payloads, then make material regressions fail in CI. This phase
must land before performance-oriented implementation begins.

## Inputs and owners

- Baseline and initial budgets: [`PLAN.md`](../../PLAN.md#ws0--measurement-and-regression-budgets)
- Browser entry and initial HTML: `src/main.ts`, `index.html`
- Startup coordinator today: `src/ts/bootstrap.ts`
- Browser-smoke hook: `src/ts/server/browserSmoke.ts`
- Browser journey: `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts`
- Server resource metrics: `server/fastify/src/protocolMetrics.ts` and
  `server/fastify/src/routes/resourceReads.ts`
- Build and test commands: `package.json`, `vite.config.ts`, and
  `.github/workflows/quality.yml`

## Review slices

### 0A. Stable readiness instrumentation

- [ ] Define one owner for startup marks and measures; keep mark names and
  one-time emission rules out of UI components.
- [ ] Record entry, shell mount, observer readiness, writer readiness, chat
  readiness, plugin readiness, and background readiness.
- [ ] Enforce monotonic timestamps and make retries record attempt/failure data
  without rewriting the first successful transition.
- [ ] Extend `FastifyBrowserSmokeHook` with a serializable phase/timing snapshot
  and wait helpers for the narrow readiness points used by tests.
- [ ] Unit-test transition ordering, duplicate suppression, retry behavior, and
  absence of browser-content data in the snapshot.

### 0B. Initial-preload build report

- [ ] Add a script under `util/` that reads a production `dist/index.html`,
  resolves the main entry and module-preload files, and reports file count plus
  raw and gzip byte totals.
- [ ] Report the largest initial chunk separately and emit both human-readable
  output and stable machine-readable data for CI artifacts.
- [ ] Add a package command that builds and runs the report in one documented
  step.
- [ ] Add deterministic tests for duplicate preloads, missing files, gzip totals,
  and paths containing encoded or nested segments.
- [ ] Gate the ratified total and per-chunk budgets in CI. Do not use manual
  chunking to make the report ignore an eager dependency.

### 0C. Server and payload timing

- [ ] Extend the existing protocol metrics rather than introducing a separate
  logging channel.
- [ ] Measure bootstrap and resource response duration and size with resource
  name, revision, cache hit/miss counts, and request UID where already available.
- [ ] Keep character, chat, prompt, plugin, and account content out of metrics.
- [ ] Add a large-database payload assertion for the character endpoint that
  Phase 2 can replace with a summary-specific budget.

### 0D. Cold/warm scenario matrix

- [ ] Define stable small and large SQLite fixtures. The large fixture must make
  historical character/chat payload growth visible.
- [ ] Measure cold browser cache plus empty resource cache separately from warm
  browser/resource cache. Never average the two populations together.
- [ ] Capture initial preload report, phase timings, resource payload totals, and
  relevant request traces for each fixture/cache combination.
- [ ] Document the single developer command and environment needed to reproduce
  the measurements.

## Initial budgets to ratify

| Measure | Initial milestone budget |
| --- | ---: |
| Initial JavaScript | At most 900 KiB gzip |
| Largest initial JavaScript chunk | At most 500 KiB gzip |
| Character summary on the large fixture | At least 80% smaller than the current aggregate |
| User mutation before writer readiness | Zero |
| Generation before chat readiness | Zero |

CI variance must be measured before these values become hard gates. Any later
change requires before/after artifacts and an explanation of the dependency
that needs the increase.

## Verification

- Run the timing and report unit tests directly.
- Run `pnpm build` and the new build-report command.
- Run the startup portion of `pnpm smoke:fastify-browser` for all four
  fixture/cache combinations.
- Run `pnpm test:affected` before handoff.

## Required artifacts

- Machine-readable and human-readable preload reports.
- Cold and warm phase-timing snapshots for small and large fixtures.
- Resource payload-size table and representative request UIDs/traces.
- A short record of CI variance and the budgets ratified from it.

## Exit gate

- One documented command reproduces local measurements.
- CI detects a material initial-preload regression.
- Readiness timestamps are ordered, one-time, and visible to browser smoke.
- The Phase 1 and Phase 2 baseline artifacts are retained for comparison.
