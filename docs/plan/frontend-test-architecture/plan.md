# Frontend Test Runtime Architecture Plan

Date: 2026-08-28

## Goal

Reduce frontend test execution time by running each test in the smallest
environment that can faithfully prove its behavior. Pure logic should run in
Node, Svelte compile/rune/store logic that does not require browser globals
should run in Svelte+Node, and Happy-DOM should be reserved for rendered or
browser-shaped contracts.

This is a behavior-preserving test architecture migration. It must not reduce
coverage by replacing visible-state assertions with internal-state assertions,
mocking away the behavior under test, or silently dropping files from discovery.

End state:

- Every frontend test is classified into exactly one runtime project.
- Plain `*.test.ts` files run in Node by default.
- Svelte-without-DOM tests have an explicit Svelte+Node route.
- Component and browser-shaped tests have explicit DOM ownership.
- Real-browser behavior remains in Playwright browser smoke.
- Pure logic embedded in expensive components is extracted only when profiling
  identifies a useful seam and a DOM contract remains behind.
- Test discovery, affected-test selection, coverage, CI, and local aggregate
  commands agree on the same ownership model.
- A standing completeness gate rejects unclassified, omitted, or multiply
  assigned tests.
- The ordinary frontend lane is materially faster without increasing flakiness,
  weakening correctness contracts, or shifting excessive cost into another
  required lane.

[`status.md`](status.md) is the live execution router. This file owns the stable
scope, decisions, invariants, phase order, and acceptance model.

## Why This Requires A Workstream

The provisional baseline contains 528 frontend files and 6,408 tests. The
existing runner has only two projects: a conservative explicit Node allowlist
and a default Svelte+Happy-DOM project. During the measured aggregate run, only
124 files ran in Node while 404 ran in Happy-DOM.

The cost is primarily architectural rather than assertion time. Vitest reported
485.51 seconds of aggregate import work, 129.94 seconds of transform work,
60.69 seconds of environment work, 31.05 seconds of setup work, and 88.89
seconds of test-body work across parallel workers. Most files are individually
small: 407 files spent less than 100 ms in test bodies.

Changing that ownership safely affects:

- root Vitest project composition and setup files;
- hundreds of test files with mixed Svelte, DOM, storage, network, and state
  dependencies;
- `test:affected` routing and runner-change widening;
- the focused UI coverage map and explicit performance gates;
- local `test:all` scheduling and CI workflow parity;
- test naming/inventory governance;
- selected production component boundaries when pure logic extraction is
  justified;
- current test and architecture documentation.

The existing global-isolation contract is significant. A diagnostic
`--no-isolate` run leaked mocks and state between DOM files and attempted DNS
requests to test-only hosts. Isolation therefore remains the default; any
exception requires a separately classified project and explicit order/leakage
proof.

## Authority And Boundary Sources

- `vitest.config.ts` owns root frontend project composition.
- `vitest.node.config.ts` and `vitest.node-tests.ts` own the current validated
  Node route.
- `vitest.dom.config.ts` and `vitest.dom.setup.ts` own the current Svelte /
  Happy-DOM route and unexpected-fetch guard.
- `vitest.setup.ts` owns setup shared by frontend projects.
- `vitest.ui-coverage-tests.ts` owns the six-file UI coverage inventory.
- `package.json` owns user-facing test and coverage commands.
- `util/affected-tests.ts` owns changed-file routing and conservative widening.
- `util/test-all.ts` owns aggregate lane ordering and isolation.
- `.github/workflows/quality.yml` owns CI lane parity.
- `docs/structure/testing-and-operations.md` and `docs/tests/README.md` describe
  the current test system and must change with landed behavior.
- The codebase and runner discovery are authoritative when inventories or
  historical counts drift.

## Capability Model

Every frontend test will ultimately belong to exactly one capability class.

### N: Node

Use for pure TypeScript behavior that does not require Svelte transformation,
DOM/browser globals, component mounting, browser focus/events, or browser-only
storage semantics.

Typical owners include parsers, model resolution, protocol/data shaping,
serialization, command planning, reducers/state transitions, validation, and
utility code.

### S: Svelte+Node

Use for modules that require Svelte transformation or rune/store evaluation but
do not require `document`, `window`, component mounting, focus, events, rendered
state, layout, or browser-only APIs.

The project must use the Svelte plugin with the Node environment. Tests must
install explicit fakes for dependencies such as IndexedDB rather than receiving
unrelated browser globals from Happy-DOM.

### D: Svelte+Happy-DOM

Use for behavior whose proof requires mounted components, rendered output,
focus, keyboard/pointer events, browser history/location, DOM observers,
accessibility surfaces, optimistic paint before settlement, or browser-shaped
integration behavior.

Moving a D test to N or S by mocking away its visible behavior is forbidden.

### B: Built Browser

Use Playwright browser smoke for contracts that require a built SPA, real
Chromium behavior, Fastify/SQLite integration, page reload, direct links,
multi-page/browser lifecycle, or behavior not represented faithfully by
Happy-DOM.

This plan does not move ordinary unit matrices into Playwright. It retains a
small number of high-value browser contracts while keeping deterministic lower
layers.

## Proposed Routing Convention

Phase 0 must ratify the exact mechanism, but the target convention is:

- `*.test.ts`: Node by default;
- `*.svelte-node.test.ts`: Svelte plugin with Node;
- `*.svelte.test.ts`: mounted/component-oriented Svelte+Happy-DOM;
- `*.dom.test.ts`: non-component DOM/browser-shaped Happy-DOM;
- Playwright `*.spec.ts`: built-browser ownership under the existing smoke
  configuration.

During migration, explicit legacy inventories may coexist with suffix routing.
The final completeness gate, not filename assumptions alone, must prove that the
union is exhaustive and disjoint. Renames should occur only when they clarify
runtime ownership; avoid high-churn renaming that provides no routing value.

## Invariants

### Coverage And Discovery

- Every previously discovered test file remains discovered unless its removal is
  independently justified and recorded.
- Each file runs in exactly one frontend project during an ordinary owning run.
- Parameterized and dynamically generated cases retain their behavior and
  expected count, with any intentional count change recorded.
- UI audit, performance gate, focused UI coverage, broad coverage, affected
  tests, and browser smoke retain their documented ownership.
- A migration may strengthen coverage, but it must not claim improved speed by
  dropping a required lane or moving required checks outside normal CI.

### Behavioral Fidelity

- DOM-visible behavior remains asserted against rendered DOM.
- Focus, accessibility, optimistic paint, rollback, race ownership, and stale
  completion contracts remain in D or B when those semantics are the subject.
- Pure-logic extraction preserves production inputs, outputs, error behavior,
  mutation scope, ordering, and timing boundaries.
- A test cannot be promoted by replacing the subject's real dependency with a
  mock that makes the original behavior unreachable.
- Production behavior changes discovered during extraction are separate fixes
  with their own regression proof; they are not folded silently into migration.

### Isolation And Network Safety

- Per-file isolation remains enabled by default.
- Tests must not perform unmocked external network requests.
- Any reduced-isolation experiment must use an explicit project/inventory and
  pass repeated, shuffled, reverse-order, and leakage checks before adoption.
- DOM unexpected-fetch protection remains active for D tests.

### Performance Evidence

- Compare like-for-like commands on the same host and toolchain.
- Record wall time, Vitest phase totals, file/test counts, peak RSS, CPU use, and
  project distribution.
- Use at least three warm runs for phase-level claims; report the median and
  range. Keep a separately labeled cold-cache result.
- A slice must not be called an optimization solely because its isolated file is
  faster; the owning project and ordinary frontend lane must not materially
  regress.
- Overall `test:all` time is the final objective. Do not make its schedule slower
  merely to make the frontend lane's displayed duration smaller.

## Performance Acceptance Model

Phase 0 will replace provisional numbers with a formal same-host baseline and
ratify final budgets. Initial targets are:

- primary: at least a 20% reduction in median standalone ordinary frontend wall
  time;
- stretch: at least a 30% reduction;
- no more than 5% regression in required UI coverage or full `test:all` median
  wall time unless an explicitly accepted new contract explains it;
- no more than 10% peak-RSS regression, with lower memory preferred;
- zero missing or multiply executed files;
- zero new flaky retries, unhandled requests, leaked handles, or order
  dependencies in repeated verification.

The provisional standalone reference is 75.13 seconds, making 60.10 seconds the
provisional 20% target and 52.59 seconds the provisional stretch target. Formal
targets must use the Phase 0 median rather than this single run.

## Work Unit And Commit Rules

- One slice is one implementation or proof batch with one primary capability or
  domain owner.
- A normal migration slice should move a reviewable set of related files, not a
  repository-wide mechanical batch.
- Each slice records source anchors, current class, target class, dependencies,
  behavior invariants, expected performance mechanism, validation, measured
  result, and rollback strategy.
- Infrastructure lands before bulk migration depends on it.
- Extraction slices land pure tests and retained DOM contracts together.
- Update `status.md` and `latest-verification.md` whenever a slice or phase
  changes state.

## Phase Overview

- [Phase 0: Baseline And Classification](phases/phase-0-baseline-and-classification.md)
  formalizes metrics, capability rules, discovery proof, and migration inventory.
- [Phase 1: Runtime Topology](phases/phase-1-runtime-topology.md) adds the
  Svelte+Node project, separates setup ownership, and validates representative
  pilots without broad migration.
- [Phase 2: Pure Node Promotion](phases/phase-2-pure-node-promotion.md) moves
  already-pure tests into Node in domain slices without production refactors.
- [Phase 3: Svelte+Node Promotion](phases/phase-3-svelte-node-promotion.md) moves
  rune/store/Svelte-compiled tests that do not need DOM semantics.
- [Phase 4: Pure Logic Extraction](phases/phase-4-pure-logic-extraction.md)
  extracts measured hotspots from components or broad entry modules while
  retaining focused DOM contracts.
- [Phase 5: DOM Contract Consolidation](phases/phase-5-dom-contract-consolidation.md)
  consolidates repeated DOM setup and clarifies visible-behavior ownership.
- [Phase 6: Routing And CI Enforcement](phases/phase-6-routing-and-ci-enforcement.md)
  makes capability routing explicit, removes the legacy fallback, and aligns
  affected tests, coverage, aggregate execution, and CI.
- [Phase 7: Verification And Closeout](phases/phase-7-verification-and-closeout.md)
  proves the final budgets, correctness, documentation, and archive handoff.

## Decision And Stopping Gates

### After Phase 1

Proceed only if the three-project topology is exhaustive, disjoint, stable, and
does not introduce material startup overhead. If Svelte+Node provides no useful
capability distinction, record the evidence and revise the topology before bulk
migration.

### After Phase 3

Re-profile the complete frontend lane. If Phases 1-3 already meet the primary
performance target, restrict Phase 4 to remaining measured critical-path files.
Do not perform broad component extraction merely because it was listed in the
original plan.

If the target is not met, Phase 4 slices must be selected from current profiler
evidence, not from static aesthetics. Start with import-heavy or sequentially
slow owners that have clean pure-logic seams.

### Before Phase 6 Default Inversion

The completeness gate must be green, every legacy fallback file must be
classified, focused coverage ownership must be explicit, and repeated full
frontend runs must be stable. Until then, retain a conservative compatibility
fallback.

## Initial Phase 4 Candidate Areas

These are candidates, not pre-approved scope:

- chat command import/chunk planning, including tests that currently construct
  production-sized 16 MiB payloads;
- router state construction/reset, which currently relies on repeated
  `vi.resetModules()` and dynamic imports;
- Settings projection/reconciliation logic represented by large mounted suites;
- ChatScreens and sidebar state derivation that can be tested separately from
  focus, paint, and event contracts;
- fixture loading/planning and reusable Fastify harness boundaries where setup
  is repeated per case.

Each candidate requires a fresh profile and a slice-specific value hypothesis.

## Not In This Plan

- Reducing assertions, deleting scenarios, or weakening DOM/browser contracts to
  meet a timing target.
- Replacing Vitest, Svelte, Happy-DOM, V8 coverage, or Playwright without a
  separate measured decision.
- Disabling isolation globally.
- Broad production UI redesign, store redesign, or persistence redesign.
- Unrelated server-suite optimization.
- Moving deterministic unit matrices into browser smoke.
- Treating archived test counts or source line numbers as current authority.
- Enforcing machine-independent absolute timing failures in CI before the
  measurement model proves they are stable.

## Execution Cursor

Planning is drafted. Begin with Phase 0's baseline/classification slice. Do not
create the Svelte+Node project or migrate test files until the discovery proof,
capability rules, and formal measurement procedure are ratified and recorded in
`status.md`.
