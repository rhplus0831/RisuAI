# Phase 0: Measurement and Budgets

## Outcome

Create a reproducible baseline for navigation-to-readiness, initial JavaScript,
and bootstrap payloads, then make material regressions fail in the documented
local build command. This phase must land before performance-oriented
implementation begins.

## Inputs and owners

- Baseline and initial budgets: [`PLAN.md`](PLAN.md#ws0--measurement-and-regression-budgets)
- Browser entry and initial HTML: `src/main.ts`, `index.html`
- Startup coordinator today: `src/ts/bootstrap.ts`
- Browser-smoke hook: `src/ts/server/browserSmoke.ts`
- Browser journey: `server/fastify/browser-smoke/fastifyBrowserSmoke.spec.ts`
- Server resource metrics: `server/fastify/src/protocolMetrics.ts` and
  `server/fastify/src/routes/resourceReads.ts`
- Build and test commands: `package.json` and `vite.config.ts`

## Review slices

### 0A. Stable readiness instrumentation

- [x] Define one owner for startup marks and measures; keep mark names and
  one-time emission rules out of UI components.
- [x] Record entry, shell mount, observer readiness, writer readiness, chat
  readiness, plugin readiness, and background readiness.
- [x] Enforce monotonic timestamps and make retries record attempt/failure data
  without rewriting the first successful transition.
- [x] Extend `FastifyBrowserSmokeHook` with a serializable phase/timing snapshot
  and wait helpers for the narrow readiness points used by tests.
- [x] Unit-test transition ordering, duplicate suppression, retry behavior, and
  absence of browser-content data in the snapshot.

### 0B. Initial-preload build report

- [x] Add a script under `util/` that reads a production `dist/index.html`,
  resolves the main entry and module-preload files, and reports file count plus
  raw and gzip byte totals.
- [x] Report the largest initial chunk separately and emit both human-readable
  output and stable machine-readable local artifacts.
- [x] Add a package command that builds and runs the report in one documented
  step.
- [x] Add deterministic tests for duplicate preloads, missing files, gzip totals,
  and paths containing encoded or nested segments.
- [x] Gate the ratified total and per-chunk budgets in the local report command.
  Do not use manual chunking to make the report ignore an eager dependency.

### 0C. Server and payload timing

- [x] Extend the existing protocol metrics rather than introducing a separate
  logging channel.
- [x] Measure bootstrap and resource response duration and size with resource
  name, revision, cache hit/miss counts, and request UID where already available.
- [x] Keep character, chat, prompt, plugin, and account content out of metrics.
- [x] Add a large-database payload assertion for the character endpoint that
  Phase 2 can replace with a summary-specific budget.

### 0D. Cold/warm scenario matrix

- [x] Define stable small and large SQLite fixtures. The large fixture must make
  historical character/chat payload growth visible.
- [x] Measure cold browser cache plus empty resource cache separately from warm
  browser/resource cache. Never average the two populations together.
- [x] Capture initial preload report, phase timings, resource payload totals, and
  relevant request traces for each fixture/cache combination.
- [x] Document the single developer command and environment needed to reproduce
  the measurements.

## Ratified initial budgets

| Measure | Initial milestone budget |
| --- | ---: |
| Initial JavaScript | At most 900 KiB gzip |
| Largest initial JavaScript chunk | At most 500 KiB gzip |
| Character summary on the large fixture | At least 80% smaller than the current aggregate |
| User mutation before writer readiness | Zero |
| Generation before chat readiness | Zero |

Variance across five reproducible clean local production builds must be measured
before these values become hard gates. Any later change requires before/after
artifacts and an explanation of the dependency that needs the increase.

### Budget calibration status

Two local production reports on 2026-08-23 measured 1,632,861-1,632,865
total gzip bytes and 668,641-668,643 gzip bytes for the largest chunk. The
provisional regression ceilings are 1,650,000 and 675,000 bytes respectively.
After the Phase 1 boundary work, the 2026-08-24 report measures 318,211 total
gzip bytes and a 283,335-byte largest chunk, comfortably below the report-only
900/500 KiB milestone targets.

Five clean local `pnpm build:initial-preload` executions from commit
`c1d437b96372479d9028393f6c6c37376718bc28` were recorded on 2026-08-24 with
Node.js 24.19.0 and pnpm 11.23.0:

| Run | Initial gzip | Largest chunk gzip | Initial files |
| ---: | ---: | ---: | ---: |
| 1 | 318,246 bytes | 283,372 bytes | 12 |
| 2 | 318,246 bytes | 283,372 bytes | 12 |
| 3 | 318,246 bytes | 283,372 bytes | 12 |
| 4 | 318,246 bytes | 283,372 bytes | 12 |
| 5 | 318,246 bytes | 283,372 bytes | 12 |

The observed range is zero bytes for both gzip measures. The five builds pass
the 900/500 KiB targets with roughly 65% total-gzip and 45% largest-chunk
headroom, so those targets are ratified as hard gates. The historical
1,650,000/675,000-byte regression ceilings remain visible for baseline context,
but `build:initial-preload` now returns a nonzero status when either ratified
milestone gate fails.

## Verification

Run `pnpm measure:fast-bootstrap` to build the production preload report,
produce the browser-smoke build, and execute the small/large cold/warm startup
matrix. Local artifacts are written under `fast-bootstrap-results/`. For a
budget recalibration, run `pnpm build:initial-preload` five times from the same
clean source revision and retain each generated report before the next run.

- Run the timing and report unit tests directly.
- Run `pnpm build` and the new build-report command.
- Run the startup portion of `pnpm smoke:fastify-browser` for all four
  fixture/cache combinations.
- Run `pnpm test:affected` before handoff.

## Required artifacts

- Machine-readable and human-readable preload reports.
- Cold and warm phase-timing snapshots for small and large fixtures.
- Resource payload-size table and representative request UIDs/traces.
- A short record of five-build local variance and the budgets ratified from it.

## Exit gate

- One documented command reproduces local measurements.
- `pnpm build:initial-preload` detects a material initial-preload regression.
- Readiness timestamps are ordered, one-time, and visible to browser smoke.
- The Phase 1 and Phase 2 baseline artifacts are retained for comparison.
