# Phase 6 Slice: Routing And CI Enforcement

Status: Complete

## Scope

- Rename the 17 validated Svelte+Node owners to `.svelte-node.test.ts` and the
  one Node owner with a conflicting `.svelte.test.ts` suffix.
- Retire the Node and Svelte+Node transition allowlists.
- Make plain tests Node-default and replace the implicit Happy-DOM complement
  with explicit suffixes plus reviewed registrations.
- Enforce final ownership locally, in affected execution, in `test:all`, and in
  CI while preserving exact coverage and performance ownership.
- Convert the checked manifest from migration-candidate markers to final
  validated runtime ownership.

## Source Anchors

- `vitest.frontend-routing.ts` owns suffix routing and the 187 reviewed
  pre-suffix DOM registrations.
- `vitest.node.config.ts`, `vitest.svelte-node.config.ts`, and
  `vitest.dom.config.ts` positively select the three capability classes.
- `util/frontend-test-inventory.ts` owns independent discovery, registration,
  source-import, and final-manifest enforcement.
- `vitest.ui-coverage-tests.ts` and `vitest.performance-tests.ts` own the exact
  specialized inventories.
- `util/affected-tests.ts`, `util/test-all.ts`, `package.json`, and
  `.github/workflows/quality.yml` own local, affected, aggregate, and CI lane
  parity.

## Ownership And Invariants

- Plain `*.test.ts` is N unless it is one of 187 explicitly registered,
  probe-backed legacy D owners.
- `*.svelte-node.test.ts` is S; `*.svelte.test.ts` and `*.dom.test.ts` are D;
  Playwright browser-smoke `*.spec.ts` remains B.
- Shared setup, per-file isolation, Svelte client transformation, Happy-DOM
  setup, and the unexpected-fetch guard retain their previous project
  boundaries.
- UI-map sentinels and performance gates run exactly once in aggregate
  execution and keep exact self-checking inventories.
- Static import evidence can reject reliable zero-DOM violations but cannot
  silently promote a test; reviewed dependency-injected exceptions have an
  explicit override path.

## Validation

- Inventory/routing unit tests: 4 files / 24 tests passed in 399ms.
- Independent projects: N 194 / 1,318; S 17 / 167; ordinary D 324 / 5,145.
- Mixed direct invocation: 5 N/S/D files / 60 tests passed.
- `pnpm check:frontend-test-inventory`: full 537 at 194 / 17 / 326;
  standalone ordinary 535 at 194 / 17 / 324; aggregate ordinary 529 at 193 /
  17 / 319; B=7.
- `pnpm test:frontend`: 535 files / 6,631 tests passed in 73.67s.
- `pnpm test:frontend:all`: 537 / 6,637 passed in 68.23s.
- `pnpm test:gates`: 4 / 38 passed in 10.94s.
- `pnpm coverage:ui-map`: 6 / 203 passed in 21.58s with all thresholds.
- `pnpm test:all --dry-run` showed the expected nine-lane graph.
- `pnpm test:affected --dry-run` widened runner/CI changes to `test:all`;
  focused planner tests cover direct, source, deletion, gate, smoke, and runner
  cases.
- Workflow YAML parsing, Prettier, and `git diff --check` passed.
- `pnpm test:all`: all nine lanes passed in 3m24.2s, including 529 frontend
  files / 6,428 tests, 154 server files / 3,295 passes with one skip, 34 browser
  cases, UI coverage, and 2 performance files / 6 tests.

## Rollback

Restore both transition allowlists and the DOM exclude-only fallback, revert
the suffix renames, remove the explicit routing/registration enforcement and
specialized aggregate/CI lane, restore conditional CI coverage ownership, and
regenerate the migration-style inventory. This would intentionally restore the
pre-Phase 6 ambiguity and is not a supported steady state.
