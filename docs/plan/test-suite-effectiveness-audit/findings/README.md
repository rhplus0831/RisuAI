# Test Suite Effectiveness Findings

Date: 2026-08-29

Status: Active; twenty-six findings are done, one remains confirmed, and two
are deferred with concrete revisit triggers.

This directory owns durable finding and decision records for the audit. Phase 0
will decide whether the working ledger remains in this index, splits into
per-phase files, or is generated from the exhaustive inventory. In every shape,
finding IDs and decisions must remain stable and reviewable after closeout.

## Finding ID Format

Use `TSA-P<phase>-<sequence>`, for example `TSA-P06-001`. A finding keeps its
original ID when implementation moves to a later phase.

## Required Finding Fields

Every finding records:

- ID, phase, primary category, and severity;
- exact test files/cases and production owner or supported contract;
- finding type: missing protection, weak assertion, self-fulfilling mock,
  duplicate evidence, obsolete contract, flake/isolation, excessive cost,
  misclassification, harness flaw, or valid retained defense in depth;
- plausible defect or invariant;
- direct evidence and counterfactual proof where required;
- companion or overlapping tests and why they are or are not equivalent;
- decision: Keep, Strengthen, Merge, Reclassify, Remove, Add, or Defer;
- implementation action, owner, dependencies, and rollback;
- validation commands and results;
- file/test-case count delta;
- state: Proposed, Confirmed, In Progress, Done, Rejected, or Deferred;
- for Deferred findings, the reason and concrete revisit condition.

## Record Template

```md
### TSA-P00-001: Short title

- State:
- Severity:
- Category:
- Decision:
- Tests/cases:
- Production owner:
- Protected contract or plausible defect:
- Evidence:
- Companion/overlap analysis:
- Action and rollback:
- Validation:
- Count delta:
- Revisit condition:
```

## Ledger Rules

- A candidate is not a confirmed low-value test until the effectiveness rubric
  and removal proof have been applied.
- Keep Informational records for close calls, intentional defense in depth, and
  architecture-policy tests whose value would otherwise be re-litigated.
- Never delete a removal record when the test file is deleted. The record is the
  durable explanation for the count and coverage delta.
- Coverage percentage, execution success, runtime cost, or apparent duplication
  alone cannot confirm a finding.
- Do not mark a finding Done until its exact validation and inventory/status
  updates land in the same slice.

## Phase 0 Findings

### TSA-P00-001: Protocol import policy misses credible dependency shapes

- State: Done in Phase 1.
- Severity: Medium.
- Category: A, with F/L seams.
- Decision: Strengthen.
- Tests/cases: `packages/protocol/src/importBoundary.test.ts`, complete two-case
  policy and counterexample matrix.
- Production owner: browser-safe `packages/protocol` runtime/export boundary.
- Protected contract or plausible defect: nested runtime files, dynamic imports,
  or `require` can introduce Node-only or outside-package dependencies without
  failing the current non-recursive static-regex test.
- Evidence: the original discovery read only top-level runtime files and its
  regex recognized static import/export syntax. The replacement recursively
  discovers runtime TypeScript and walks the TypeScript syntax tree for static
  imports/exports, dynamic imports, `require`, and import-equals declarations.
  The negative fixture proves nested Node imports and a relative package escape
  are rejected while import-looking text is ignored.
- Companion/overlap analysis: `check:protocol` protects types and compilation,
  not the complete browser/dependency policy. The architecture test remains the
  right evidence owner after strengthening.
- Action and rollback: strengthened the existing oracle without changing
  production runtime. The test-only change can be reverted independently.
- Validation: 2/2 focused policy cases passed; `pnpm check:protocol` and the
  exhaustive inventory checks passed.
- Count delta: no file delta; one counterexample case added, taking the live
  collected total from 9,975 to 9,976.
- Revisit condition: reopen only if the protocol adopts a non-TypeScript runtime
  module or a supported dependency syntax not represented in the AST walk.

### TSA-P00-002: Translator preset retry case is load/order-sensitive

- State: Confirmed evidence; root cause pending Phase 5 with Phase 1 harness
  support if global cleanup is implicated.
- Severity: Medium.
- Category: E, with B/C seams.
- Decision: Pending file disposition; strengthen the failing case or its product
  owner after fault isolation.
- Tests/cases:
  `TranslatorPresetSettings.svelte.test.ts > TranslatorPresetSettings server-backed edits > reasserts a retryable optimistic delete after an authoritative collection projection`.
- Production owner: server-backed translator-preset optimistic delete and
  authoritative collection reconciliation.
- Protected contract or plausible defect: a retryable delete can fail to
  reassert after a projection and visibly resurrect a removed preset.
- Evidence: the first measured full frontend lane received `preset-a` and
  `preset-b` where only `preset-b` was expected; the exact case then passed
  alone, and the next complete frontend lane passed all 6,638 anchor cases.
- Companion/overlap analysis: isolated success rules out a stable deterministic
  failure but does not distinguish shared-state cleanup from a real scheduling
  race. No companion currently disposes of the visible reconciliation contract.
- Action and rollback: reproduce with recorded seed/repetition/load, inspect
  fixture cleanup and projection barriers, then land a focused test-harness or
  product fix. No current test is removed or weakened.
- Validation: named case, repeated owning file, complete frontend lane, and
  affected inventory checks.
- Count delta: None.
- Revisit condition: Phase 5 translator preset slice, or earlier if Phase 1
  identifies the responsible global/setup leak.

## Phase 1 Findings

### TSA-P01-001: Affected selection omits shared and deleted owners

- State: Done.
- Severity: Medium.
- Category: A.
- Decision: Strengthen, then Keep.
- Tests/cases: `util/affected-tests.test.ts`, all 15 planning and parser cases.
- Production owner: `util/affected-tests.ts` local changed/deleted-file routing.
- Protected contract or plausible defect: protocol runtime changes, shared
  Fastify helpers/fixtures, and the source side of a rename could select no
  validation, allowing local handoff with a broken shared contract or stale
  inventory.
- Evidence: controlled plans for `packages/protocol/src/generationSse.ts`,
  `server/fastify/__tests__/helpers/terminalFrameAssertions.ts`,
  `server/fastify/__fixtures__/risuSave/fixtures.ts`, and a test renamed into
  documentation all returned zero commands before remediation. Protocol package
  and TypeScript configuration were also not conservative full-suite owners.
- Companion/overlap analysis: CI complete lanes limit merge risk but do not make
  a falsely empty local affected plan acceptable. `test:all` remains the manual
  conservative fallback.
- Action and rollback: protocol sources now select protocol typecheck plus both
  dependency-aware lanes; protocol configuration widens to `test:all`; existing
  Fastify support selects dependency-aware server tests and deletions select the
  full server lane; rename parsing records the source as deleted. Revert is
  isolated to affected-selection policy and its tests.
- Validation: 15/15 focused cases passed. The P01-S01 representative dry-run
  matrix and full aggregate own final phase proof.
- Count delta: no file delta; four focused policy cases added, taking the live
  collected total from 9,976 to 9,980.
- Revisit condition: reopen when a new workspace package or test-support root is
  added, or when affected routing becomes graph-generated.

### TSA-P01-002: Server and browser inventories do not prove runner discovery

- State: Done.
- Severity: Medium.
- Category: A.
- Decision: Strengthen, then Keep.
- Tests/cases: `util/frontend-test-inventory.test.ts`, all nine oracle cases.
- Production owner: Fastify Vitest and Playwright discovery, alongside the three
  frontend Vitest projects and checked capability manifest.
- Protected contract or plausible defect: a tracked Fastify test or browser
  spec can fall outside its runner configuration while filesystem-derived
  effectiveness and support manifests remain green.
- Evidence: the frontend inventory compared independent files with three
  resolved Vitest projects, but browser rows were filesystem-only and no
  resolved Fastify comparison existed. Current runners happened to match 154
  and 7 files; no check made that durable.
- Companion/overlap analysis: case-count collection reflects a prior resolved
  run but is a checked artifact, not a live discovery assertion. CI executes
  what the config selects and cannot report an omitted owner.
- Action and rollback: the live manifest check now parses resolved Fastify
  `--filesOnly` and Playwright JSON listing, comparing each to independent
  filesystem ownership. Parser and mismatch counterexamples are retained.
- Validation: 9/9 focused cases passed; the live check resolved 538 frontend,
  154 Fastify, and 7 browser files with no omission or unexpected owner.
- Count delta: no file delta; two oracle cases added, taking the live total from
  9,980 to 9,982.
- Revisit condition: reopen if a second Fastify/Playwright project or non-TS
  test suffix is introduced.

### TSA-P01-003: Aggregate phase and CI parity are only implicit

- State: Done.
- Severity: Low.
- Category: A.
- Decision: Strengthen, then Keep.
- Tests/cases: `util/test-all.test.ts`, all six topology and parity cases.
- Production owner: `util/test-all.ts` regular/isolated phase graph and
  `.github/workflows/quality.yml` required jobs.
- Protected contract or plausible defect: isolated-lane dependencies escaped
  graph validation because only regular lanes entered the scheduler; local and
  CI owner parity could drift without a failing test.
- Evidence: `browser-smoke.after = ['server-check']` worked because all isolated
  lanes happened to run after the regular pool, not because the complete graph
  was checked. No test mapped the nine aggregate owners to CI commands and
  `verify.needs`.
- Companion/overlap analysis: real aggregate/CI runs detect lane failures but
  cannot detect a lane silently removed from both scheduling or verification.
  Initial preload remains an intentional documented CI-only superset.
- Action and rollback: validate all lane IDs/dependencies, reject regular lanes
  depending on isolated phases, enforce isolated declaration order, and map
  every local lane to its CI job/command/verify dependency.
- Validation: 6/6 focused cases and `pnpm test:all --dry-run` passed; the real
  aggregate remains the slice closeout proof.
- Count delta: no file delta; two policy cases added, taking the live total from
  9,982 to 9,984.
- Revisit condition: reopen when aggregate phase semantics or quality workflow
  job ownership changes.

### TSA-P01-004: Local and CI package-manager majors differ

- State: Done.
- Severity: Low.
- Category: A.
- Decision: Strengthen configuration.
- Tests/cases: package installation and all quality workflow jobs; no tracked
  test-file owner.
- Production owner: `package.json`, `pnpm-lock.yaml`, and
  `.github/workflows/quality.yml` toolchain reproducibility.
- Protected contract or plausible defect: local pnpm 11 and CI pnpm 10 can
  resolve or execute workspace/lockfile semantics differently, weakening parity
  claims and making failures environment-specific.
- Evidence: the Phase 0 environment reported local pnpm 11.23.0 while all ten
  quality jobs installed major 10 and `package.json` declared no package manager.
- Companion/overlap analysis: the v9 lockfile happened to install with both
  majors, but lockfile compatibility is not proof of identical CLI semantics.
- Action and rollback: declare `pnpm@11.23.0` and install that exact version in
  every quality job. Revert changes only toolchain selection.
- Validation: `pnpm install --frozen-lockfile` was already up to date, reported
  pnpm 11.23.0, and left the lockfile unchanged.
- Count delta: none.
- Revisit condition: update declaration and workflow together when intentionally
  upgrading pnpm, with a frozen install and full aggregate.

### TSA-P01-005: UI coverage denominator includes test harnesses

- State: Done.
- Severity: Low.
- Category: A.
- Decision: Strengthen configuration.
- Tests/cases: the six UI-map sentinel files (203 cases) and the coverage-owner
  assertion in `util/test-all.test.ts`.
- Production owner: focused UI coverage denominator across ChatScreens, Others,
  SideBars, and client server bridges.
- Protected contract or plausible defect: test-only mounted hosts, stubs, and
  harness utilities inflate the reported production coverage signal and can
  hide denominator drift.
- Evidence: 28 checked `shared-helper-harness` files contributed 160 lines and
  201 statements; 56 lines and 75 statements were covered. Their inclusion
  raised the aggregate slightly from production-only values.
- Companion/overlap analysis: the harness files remain valuable support owners
  and are tested through their consumers; excluding them from a production
  denominator does not remove execution or assertions.
- Action and rollback: add the exact 28 support paths to a coverage exclusion
  registry and check that registry against the support manifest. Thresholds
  remain unchanged.
- Validation: 7/7 aggregate/owner policy cases passed; UI coverage passed
  203/203 at 14.44% lines, 14.83% statements, 18.13% functions, and 9.45%
  branches, above the 8/7/5/4 floors.
- Count delta: no file delta; one owner-policy case added, taking the live total
  from 9,984 to 9,985.
- Revisit condition: any support-manifest or UI coverage root change must update
  the checked registry before the gate can pass.

### TSA-P01-006: CI omits successful Phase 7 browser artifacts

- State: Done.
- Severity: Medium.
- Category: A, with B/L seams.
- Decision: Strengthen CI reporting and correct documentation.
- Tests/cases: all seven browser specs / 34 cases; workflow owner assertion in
  `util/test-all.test.ts`.
- Production owner: browser-smoke artifact reporting and quality workflow.
- Protected contract or plausible defect: CI runs the Phase 7 recovery matrix
  but discards its successful machine/human reports, while documentation claims
  it is not run at all.
- Evidence: Playwright listing includes
  `startupRecoveryIntegrationMatrix.spec.ts`; its `afterAll` writes
  `fast-bootstrap-results/phase7-integration.{json,txt}`. The smoke upload
  included only `test-results` and `startup-matrix.*` and ignored absent files.
- Companion/overlap analysis: retained failure traces help browser debugging but
  do not replace the successful semantic matrix artifact. The explicit Phase 7
  wrapper remains a useful local combined measurement command.
- Action and rollback: upload Phase 7 reports, require expected smoke/UI
  artifacts to exist, check the workflow upload policy, and correct current
  documentation.
- Validation: focused workflow parity test passed; the Phase 0 aggregate had
  already produced both Phase 7 report files during the normal 34/34 smoke run.
- Count delta: none.
- Revisit condition: any browser artifact filename or smoke discovery change
  must update workflow ownership and the parity assertion together.

### TSA-P01-007: Missing baseline masks current compatibility evidence

- State: Done; full differential remains blocked by its pinned prerequisite.
- Severity: Medium.
- Category: A, with F seams.
- Decision: Strengthen compatibility orchestration.
- Tests/cases: 16 current matrix cells and 2 cluster regressions in
  `test/compat-harness/current.runner.ts` and `cluster10.runner.ts`.
- Production owner: current Fastify prompt/generation composition, cluster
  replay/continue regressions, and compatibility golden diagnostics.
- Protected contract or plausible defect: the missing external baseline stopped
  the orchestrator before current-only evidence ran; golden mismatches then
  deleted their only actual artifact during scratch cleanup.
- Evidence: direct current-config execution passed 18/18 independently, while
  `test:compat-harness` failed at `assertBaseline()` before either current
  runner. The old mismatch path printed only the expected golden location.
- Companion/overlap analysis: current goldens cannot prove the historical
  differential, so the pinned full command and all four golden owners remain.
  They do provide meaningful assurance when the external worktree is absent.
- Action and rollback: add `test:compat-current`, make affected selection use
  it with an explicit full-harness note, and preserve mismatch actuals under
  ignored diagnostics. Golden updates still require the explicit update env.
- Validation: `pnpm test:compat-current` passed 18/18 in 5.56s and matched 16
  current cells plus both healthy cluster regressions; affected policy passed
  15/15.
- Count delta: none; compatibility cases remain outside the 699-file/9,985-case
  tracked universe.
- Revisit condition: run the full differential when the exact pinned worktree
  and dependencies exist; never substitute a different baseline.

### TSA-P01-008: Realm scale contract has no required owner

- State: Done.
- Severity: Medium.
- Category: A horizontal ownership; K product contract.
- Decision: Add required isolated lane; Realm file disposition remains pending
  Phase 11.
- Tests/cases: the 7,000-display-asset case in
  `server/fastify/__tests__/realmImport.test.ts`.
- Production owner: bounded Realm/CharX staging and display-asset persistence at
  large library scale.
- Protected contract or plausible defect: the sole ordinary skip could silently
  rot or regress in cost because it ran only when a developer knew the exact
  direct-file invocation.
- Evidence: ordinary server collection skips the case by design; its direct
  Phase 0 run passed in 3.15s, demonstrating it is cheap enough for an isolated
  required owner.
- Companion/overlap analysis: smaller Realm cases protect semantics but do not
  exercise thousands of display assets. Isolation prevents concurrent load from
  distorting the capacity evidence.
- Action and rollback: add `test:server:realm-scale`, an isolated aggregate lane
  after server tests, a separate CI job, verify dependency, and checked local/CI
  mapping. Ordinary server discovery retains the skip to avoid double execution.
- Validation: focused lane passed its selected case (26 filtered) in 2.64s;
  7/7 aggregate-policy cases and the ten-lane dry run passed.
- Count delta: none; this executes the existing sole skipped tracked case.
- Revisit condition: reassess timeout/fixture size only with measured artifacts;
  do not fold it into concurrent ordinary execution without proving stability.

### TSA-P01-009: Global KaTeX mock hides formula rendering

- State: Done; the owning parser file remains partially reviewed for Phase 9.
- Severity: Medium.
- Category: A harness, with I product ownership.
- Decision: Strengthen the selected case; complete-file decision remains Pending.
- Tests/cases: the real-formula case in
  `src/ts/parser/tests/renderFastPaths.test.ts`; the other nine cases retain
  their Phase 9 owner.
- Production owner: `src/ts/parser/parser.svelte.ts` formula rendering and the
  KaTeX runtime dependency.
- Protected contract or plausible defect: formula rendering can regress to raw
  delimiters or the error fallback while every frontend test sees an empty
  KaTeX module and therefore cannot exercise successful rendering.
- Evidence: shared setup replaced `katex` globally. Removing that mock and
  rendering an exponent now proves the DOM contains KaTeX MathML, including an
  `msup`, and no raw formula delimiters.
- Companion/overlap analysis: fallback parser cases remain useful failure-path
  evidence but cannot replace successful integration with the behavior owner.
- Action and rollback: removed the global mock and added one real-render case.
  Tests needing isolation must use a scoped faithful mock. Revert is confined to
  setup and the selected parser case.
- Validation: the combined setup/parser focus passed 14/14; the complete
  frontend lane passed 6,651/6,651 across 536 files in 71.88s.
- Count delta: no file delta; one parser case added, taking the live total from
  9,985 to 9,986.
- Revisit condition: review the complete parser fast-path file in Phase 9.

### TSA-P01-010: Fully ready setup leaves generation disabled

- State: Done.
- Severity: Medium.
- Category: A.
- Decision: Strengthen, then Keep.
- Tests/cases: `vitest.setup.test.ts`, all four clone/readiness cases.
- Production owner: `vitest.setup.ts` and production startup-readiness state.
- Protected contract or plausible defect: shared setup advertises a fully ready
  application while generation remains disabled, so tests inherit a misleading
  capability state and may become order-dependent.
- Evidence: the setup settled shell, routes, plugins, background work, and
  mutation but omitted generation-recovery readiness. A direct oracle now pins
  all six public capability/readiness selectors to `true` after setup.
- Companion/overlap analysis: `startupReadiness.test.ts` owns narrow transition
  and failure states; only the setup oracle owns the global default inherited by
  every frontend test.
- Action and rollback: settle generation recovery in the all-ready baseline and
  retain the exact capability-vector assertion. Focused tests may still reset
  narrower states explicitly.
- Validation: 4/4 setup cases and the complete 6,651-case frontend lane passed.
- Count delta: no file delta; one setup case added, taking the live total from
  9,986 to 9,987.
- Revisit condition: update the baseline and exact oracle together when a new
  public readiness capability is introduced.

### TSA-P01-011: Row-stability oracle ignores unexpected inserts

- State: Done.
- Severity: High.
- Category: A harness, with C product ownership.
- Decision: Strengthen the shared oracle.
- Tests/cases: two direct oracle cases in
  `server/fastify/__tests__/commandMutationBudget.test.ts` and all consumers of
  `helpers/rowStability.ts`.
- Production owner: narrow command-write scope and stable unrelated SQLite rows.
- Protected contract or plausible defect: a targeted command can insert or
  delete an unrelated row while the oracle checks only before-existing IDs and
  remains green.
- Evidence: the prior loop visited only `before`; a controlled after-only row
  passed. The symmetric union now rejects undeclared inserts, deletes, and rowid
  replacement while permitting explicit target IDs. It exposed the legitimate
  `fork-1` insert, which is now declared at its call site.
- Companion/overlap analysis: table-budget metrics name written tables but not
  affected row identities. The two oracles protect distinct scope levels.
- Action and rollback: strengthened the helper and retained direct negative and
  allowed-target cases. Roll back only with an equally symmetric row oracle.
- Validation: direct oracle 8/8, single-row paths 21/21, four dependent range
  suites 81/81, and the focused commands consumer passed.
- Count delta: two cases added, taking the live total from 9,987 to 9,989.
- Revisit condition: every new row-stability consumer must declare legitimate
  inserts/deletes explicitly.

### TSA-P01-012: Table budgets accept missing written-table evidence

- State: Done.
- Severity: High.
- Category: A harness, with C product ownership.
- Decision: Strengthen the shared oracle.
- Tests/cases: two direct cases in
  `server/fastify/__tests__/commandMutationBudget.test.ts` and every
  `assertCommandMetricGate` consumer.
- Production owner: command mutation table-scope metrics.
- Protected contract or plausible defect: instrumentation can omit
  `writtenTables`, causing exact/subset/disjoint table constraints to be skipped
  while the budget gate reports success.
- Evidence: the previous helper entered table checks only when the optional
  field existed. It now requires an array whenever any table budget is declared;
  direct absent/present counterexamples pin the behavior.
- Companion/overlap analysis: row stability detects identity churn in selected
  fixtures; table budgets cover every instrumented command path and forbidden
  table class.
- Action and rollback: require evidence at the oracle boundary without changing
  production metric semantics.
- Validation: the focused mutation-budget owner passed 6/6 before the row cases
  joined it and 8/8 as the combined oracle suite.
- Count delta: two cases added, taking the live total from 9,989 to 9,991.
- Revisit condition: a metric may make table evidence optional only after its
  gate removes every table constraint explicitly.

### TSA-P01-013: Memory embedding test seam is absent from support ownership

- State: Done.
- Severity: Medium.
- Category: A, with H ownership.
- Decision: Strengthen the exhaustive support manifest.
- Tests/cases: the existing seven-case effectiveness-inventory oracle; no new
  case registration.
- Production owner: `server/fastify/src/memoryEmbedJobHandler.ts` provider
  deadline and contextual subbatch-budget test controls.
- Protected contract or plausible defect: mixed production/test seams can evade
  the horizontal harness review and later become stale or behavior-defining
  without an accountable owner.
- Evidence: both controls are consumed by tests but the file was absent from the
  64-row mixed seam list. It is now an explicit 65th row and a focused assertion
  prevents removal from the linked manifests.
- Companion/overlap analysis: ordinary test discovery cannot find test seams in
  production files; the support manifest is the unique exhaustive owner.
- Action and rollback: add the exact seam and rationale to generated support
  discovery and its checked artifact.
- Validation: 7/7 inventory cases and all three inventory checks passed at 253
  standalone artifacts and 65 mixed seams.
- Count delta: none.
- Revisit condition: remove the manifest row only when the controls and every
  test consumer are removed together.

### TSA-P01-014: Server-backed send fixtures wait by event-loop guess

- State: Done.
- Severity: Medium.
- Category: A harness, with F ownership.
- Decision: Strengthen synchronization.
- Tests/cases: all 27 cases in
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`.
- Production owner: queued server commands and reconciliation after a
  server-backed send.
- Protected contract or plausible defect: three microtasks and two
  `setImmediate` turns can finish before or long after route-backed command work,
  creating load/order sensitivity and assertions against intermediate state.
- Evidence: production already exports
  `drainServerCommandExecutionForTests`, which observes the queue tail and active
  reconciliation batch. The fixture now waits on that seam directly.
- Companion/overlap analysis: server command tests own queue mechanics; this
  fixture needs the drain to make its send outcomes trustworthy.
- Action and rollback: replace the fixed scheduling sequence with the observable
  barrier; no product behavior or expected fixture changed.
- Validation: the complete server-backed fixture passed 27/27.
- Count delta: none.
- Revisit condition: preserve an observable completion seam if command
  scheduling is redesigned.

### TSA-P01-015: Legacy RisuSave fixtures are generated by the current codec

- State: Done.
- Severity: High.
- Category: A harness, with K ownership.
- Decision: Strengthen compatibility evidence.
- Tests/cases: legacy raw, compressed, and stream rows in
  `server/fastify/__fixtures__/risuSave/fixtures.ts` and their codec consumers.
- Production owner: historical `.risu` envelope decoding.
- Protected contract or plausible defect: encoder and decoder can drift in the
  same way while module-load-generated fixtures preserve a false round-trip
  green result.
- Evidence: the three rows called the current encoder. They now contain frozen
  bytes produced through the pre-Fastify `/home/codex/Risuai` encoder algorithm
  at its pinned `msgpackr` 1.10.1 boundary; the bytes differ from the current
  custom encoder's output and cannot be regenerated by the subject under test.
- Companion/overlap analysis: current-codec round trips remain valuable for
  writer/reader consistency but no longer stand in for historical compatibility.
- Action and rollback: freeze the independent vectors and remove their obsolete
  fixture wrapper; keep expected decoded shapes unchanged.
- Validation: codec and bounded-inflate owners passed 39/39.
- Count delta: none.
- Revisit condition: add a newly sourced historical vector rather than
  regenerating these bytes when an older supported envelope variant is found.

### TSA-P01-016: Harness surfaces retain proven orphan exports

- State: Done.
- Severity: Low.
- Category: A.
- Decision: Remove after repository-wide consumer proof.
- Tests/cases: no test case removed; support owners are `domStateOracle.ts`,
  `browserSmoke.ts`, and `risuSave/fixtureHarness.ts`.
- Production owner: test-only DOM readers, browser smoke hook, and save-fixture
  facade.
- Protected contract or plausible defect: unused helper surfaces imply evidence
  sharing that does not exist and increase migration/maintenance cost.
- Evidence: repository-wide symbol searches found no consumer for the removed
  differential formatter, generation-picker/chat-row readers, browser refresh
  and forward-swipe hook entries, or save wrapper exports. Used toggle readers,
  reroll-back behavior, and codec helpers remain.
- Companion/overlap analysis: no stronger test replaces these symbols because
  no test invoked them; their comments and types were the only apparent owners.
- Action and rollback: removed 48 lines after consumer proof. Restore a smaller
  helper only with its first real consumer.
- Validation: DOM oracle 3/3, RisuSave codec 34/34, client-library typecheck, and
  the complete browser-smoke lane passed.
- Count delta: no file or case delta.
- Revisit condition: none; new shared behavior must land with a direct consumer.

### TSA-P01-017: Resource database adapter changes the bootstrap test surface

- State: Deferred with bounded evidence claims.
- Severity: Medium.
- Category: A harness, with C/F/K product ownership.
- Decision: Reclassify adapter-backed assertions, then migrate consumers.
- Tests/cases: adapter consumers in `generation.chat.test.ts`,
  `commandSettingsAndPluginStorageRange.test.ts`, `commands.test.ts`,
  `risuSaveImportRoute.test.ts`, `backups.test.ts`, and
  `risuSaveBundleImportRoute.test.ts`; `durableGeneration.test.ts` already uses
  the direct composed-resource reader.
- Production owner: public settings, collections, and character aggregate reads;
  production `/api/v1/bootstrap` is runtime-only.
- Protected contract or plausible defect: an assertion written as
  `bootstrap.json().database` can be misreported as bootstrap wire evidence even
  though a test-local `app.inject` adapter synthesizes it from three public
  resources.
- Evidence: the adapter is local to each Fastify instance, checks one converged
  revision, and does not change production. Its six consumers are therefore
  valid read-after-write resource evidence but not bootstrap response evidence.
- Companion/overlap analysis: direct bootstrap contract tests remain unadapted;
  persistence loaders and direct resource routes provide independent storage/API
  layers.
- Action and rollback: keep the adapter as an explicit migration boundary and
  exclude its consumers from bootstrap wire claims. Migrate each consumer to a
  named composed-resource read during its owning product phase, then delete the
  monkeypatch when the last import disappears.
- Validation: all adapter consumers pass in the complete Fastify lane.
- Count delta: none.
- Revisit condition: Phases 3, 6, and 11 must migrate their respective consumers;
  Phase 13 removes the helper after `rg` finds no installer import.

### TSA-P01-018: Browser smoke intentionally changes production semantics

- State: Done as an evidence-boundary record.
- Severity: Informational.
- Category: A horizontal owner.
- Decision: Keep the harness with bounded claims.
- Tests/cases: all seven browser specs / 34 cases and their shared smoke hook.
- Production owner: built SPA, Fastify, SQLite, startup, recovery, navigation,
  and durable command/generation integration under deterministic smoke mode.
- Protected contract or plausible defect: smoke-only auth, shortened refresh,
  observer rollout control, and disabled worker/GC activity can be mistaken for
  proof of live provider/auth UI, production timing, worker, or asset-GC behavior.
- Evidence: smoke mode uses a fixed auth path and deterministic hook, shortens a
  finalization refresh, and disables unrelated background work. The built chunks,
  real browser, resource protocol, command paths, and SQLite durability remain
  live.
- Companion/overlap analysis: provider/auth/security, workers, GC, and production
  timing retain their Fastify/unit owners in later categories. Smoke uniquely
  proves the named cross-layer journeys.
- Action and rollback: document the exclusion boundary while retaining all
  seven specs, serial per-file execution, required artifacts, and screenshots.
- Validation: Playwright passed 34/34 in the Phase 1 aggregate attempt.
- Count delta: none.
- Revisit condition: update the claim boundary whenever smoke-mode behavior or a
  shared hook changes.

## Phase 2 Findings

### TSA-P02-001: Replay reorders committed cross-tab mutations by wall clock

- State: Done.
- Severity: High.
- Category: B.
- Decision: Strengthen, then Keep.
- Tests/cases: all ten `pendingMutationReplay.test.ts` cases, especially the
  serial deferred-dispatch and divergent-sequence committed-order cases.
- Production owner: `pendingMutationReplay.ts` over the durable order returned
  by `listPendingMutations()`.
- Protected contract or plausible defect: tab-local clocks and sequence offsets
  can reverse mutations after IndexedDB has already committed their global
  order, applying newer work before its predecessor.
- Evidence: replay sorted non-cancel rows by `handle.sequence`; the outbox had
  already sorted by committed `order`. Every former replay fixture used
  sequence `1`, so the regression could stay green. The counterexample gives
  the first committed row a larger sequence and now observes it dispatch first.
- Companion/overlap analysis: the cross-tab outbox suite proves counter/order
  publication but does not execute replay; the pure replay owner is the
  necessary coordinator companion.
- Action and rollback: retain stable cancellation priority while preserving
  list order for all non-cancel rows. Reverting the change reopens the exact
  counterexample.
- Validation: 10/10 replay cases and the durable browser recovery journey pass.
- Count delta: one case added; no file delta.
- Revisit condition: reopen if durable ordering authority moves out of the
  outbox `order` field.

### TSA-P02-002: Lorebook refresh accepts a different character identity

- State: Done.
- Severity: High.
- Category: B.
- Decision: Strengthen, then Keep.
- Tests/cases: negotiated single-lorebook hydration and targeted invalidation;
  13 and 99 cases respectively.
- Production owner: `hydrationReads.ts` response validation and
  `resourceInvalidation.ts` targeted apply.
- Protected contract or plausible defect: a response for another resident
  character can overwrite that character while satisfying a refresh requested
  for the selected target.
- Evidence: character, selection, and chat branches checked returned identity;
  the single lorebook branch did not, and its transport accepted any string ID.
  New wrong-resident counterexamples fail closed at both boundaries.
- Companion/overlap analysis: Fastify resource-read tests prove endpoint shape,
  not client target ownership; both client validations remain defense in depth.
- Action and rollback: require the response ID to equal the requested ID before
  returning or applying it.
- Validation: hydration 13/13 and invalidation 99/99 passed.
- Count delta: two cases added; no file delta.
- Revisit condition: none unless the protocol intentionally supports a
  redirect with an authenticated target-mapping contract.

### TSA-P02-003: DOM observer is misclassified and leaks audio on teardown

- State: Done.
- Severity: Medium.
- Category: Reclassified from B to D, with a G media seam.
- Decision: Reclassify, Strengthen, then Keep.
- Tests/cases: all eleven `observer.svelte.test.ts` DOM/code/BGM cases.
- Production owner: `observer.svelte.ts` optional DOM MutationObserver and BGM
  lifecycle.
- Protected contract or plausible defect: app/remount cleanup can disconnect
  mutations while leaving current audio or an autoplay retry alive.
- Evidence: public `stopObserveDom()` omitted the audio/retry cleanup used only
  by the test reset. `bootstrap.ts` calls that public cleanup. Active-playback
  and pending-retry teardown counterexamples now assert no survivor.
- Companion/overlap analysis: writer/observer projection suites share only the
  word "observer". These cases are visible DOM/media behavior and are not
  replaceable by state-shell tests.
- Action and rollback: stop audio, detach retry listeners, and reset control
  ownership during public teardown; route the retained test to category D.
- Validation: 11/11 focused cases and the regenerated category inventory pass.
- Count delta: two cases added; category B changes from 32 to 31 files while D
  changes from 112 to 113; no file delta.
- Revisit condition: Phase 4 owns the visible DOM contract and Phase 7 preserves
  the media seam.

### TSA-P02-004: Startup and recovery cleanup claims omit failure paths

- State: Done.
- Severity: Medium.
- Category: B.
- Decision: Strengthen, then Keep.
- Tests/cases: actual `main.ts` wiring, startup readiness, observer flag,
  projection discard, and lifecycle recovery owners.
- Production owner: entry loading, capability retry caches, observer projection
  disposal, rollout storage fallback, and shared physical browser listeners.
- Protected contract or plausible defect: rejected work can remain cached,
  replacement can retain detail/cache identities, blocked storage can escape,
  or final unsubscribe can still deliver queued recovery.
- Evidence: prior tests covered successful helper calls, auth-loss cleanup, and
  one visibility/pageshow burst, but not the actual entry module, rejected
  retry cleanup, replacement cache/hydration state, storage exceptions, hidden
  state, listener isolation, queued cancellation, or reinstall.
- Companion/overlap analysis: bootstrap integration and browser journeys remain
  cross-layer companions; these focused owners uniquely observe internal cache
  and listener state.
- Action and rollback: add failure-then-success and teardown counterexamples
  without widening production semantics.
- Validation: focused owners pass 4 entry, 12 readiness, 4 flag, 3 projection,
  and 4 lifecycle cases.
- Count delta: eight cases added; no file delta.
- Revisit condition: reopen when entry, capability, or physical lifecycle
  ownership changes.

### TSA-P02-005: Resource cache budgets and unreadable manifests are unproved

- State: Done with bounded residual in `TSA-P02-009`.
- Severity: Medium.
- Category: B.
- Decision: Strengthen, then Keep.
- Tests/cases: all eleven `resourceCache.test.ts` cases.
- Production owner: disposable content-addressed IndexedDB cache validation,
  per-value budget, manifest population pruning, and corrupt-row fallback.
- Protected contract or plausible defect: oversized values or excess manifests
  can escape pruning, and malformed rows can be advertised as valid cache hits.
- Evidence: only the 8,192-hash request cap was previously exercised. New cases
  reject a value over 32 MiB, retain only 512 manifests, and treat a size/hash
  mismatch as an empty disposable snapshot.
- Companion/overlap analysis: negotiated hydration tests prove full-GET fallback
  after cache misses; real quota, versionchange, and aggregate-pressure behavior
  remains a browser-storage residual rather than a reason to remove unit proof.
- Action and rollback: retain the new budget/pruning counterexamples.
- Validation: 11/11 focused cache cases passed.
- Count delta: three cases added; no file delta.
- Revisit condition: `TSA-P02-009` owns real-browser quota/upgrade and complete
  aggregate byte/entry pressure.

### TSA-P02-006: Browser recovery journeys contain false-success oracles

- State: Done.
- Severity: Medium.
- Category: B.
- Decision: Strengthen, then Keep.
- Tests/cases: the one startup-cache matrix case and all seven Phase 7 startup
  recovery integration cases.
- Production owner: compiled SPA startup/resource protocol, durable replay,
  event reconnect, writer takeover, and optional runtime isolation.
- Protected contract or plausible defect: equal small/large fixtures, unrelated
  foreground fetches, failed receipt acknowledgements, reconnect-before-refresh,
  vacuous denial/revocation, or capability booleans without a real mutation can
  all satisfy the former assertions.
- Evidence: the fixed 50 ms wait was replaced by protocol-metric polling;
  fixture/cache cells and population differences are explicit; direct links
  reject non-runtime route overfetch; acknowledgements require HTTP 200; event
  order records every full refresh before the new event stream; observer and
  revoked writer tabs attempt real denied mutations; optional runtime rows
  execute a successful mutation.
- Companion/overlap analysis: unit coordinators cannot replace compiled-browser
  request order and visible ownership evidence. Smoke-mode exclusions remain
  bounded by `TSA-P01-018`.
- Action and rollback: retain the stronger request/response and protocol
  settlement oracles; do not restore fixed sleeps.
- Validation: startup cache 1/1 and recovery integration 7/7 passed in Chromium.
- Count delta: no case or file delta.
- Revisit condition: update the explicit startup-runtime allowlist whenever a
  resource surface intentionally changes.

### TSA-P02-007: Rollback equality depends on object insertion order

- State: Done.
- Severity: Medium.
- Category: B.
- Decision: Strengthen, then Keep.
- Tests/cases: all fourteen `staleStateGuards.test.ts` cases.
- Production owner: attempted field and keyed-list rollback guards.
- Protected contract or plausible defect: semantically equal JSON with reordered
  keys compares unequal, so a failed optimistic value can survive instead of
  rolling back.
- Evidence: equality used ordinary `JSON.stringify`. Field and keyed-list
  counterexamples construct the same nested JSON in different key order and
  now roll back through a canonical-key snapshot.
- Companion/overlap analysis: bridge suites consume the primitive but do not
  independently exercise arbitrary insertion order.
- Action and rollback: canonicalize object keys recursively while preserving
  array order and JSON serialization semantics.
- Validation: 14/14 focused guard cases passed.
- Count delta: two cases added; no file delta.
- Revisit condition: replace with a shared JSON comparator only if it preserves
  the same array and serialization contract.

### TSA-P02-008: Ownership tests accept late gates and missing headers

- State: Done.
- Severity: Medium.
- Category: B.
- Decision: Strengthen, then Keep.
- Tests/cases: Fastify active-writer/bootstrap and client bootstrap transport.
- Production owner: writer guard route hooks, observer bootstrap identity, and
  authentication/observer response contracts.
- Protected contract or plausible defect: a route can mutate before returning
  423, read-only bootstrap can omit observer identity, or setup/observer checks
  can pass on an unrelated status-shaped response.
- Evidence: representative stale import/asset/backup/storage attempts now prove
  no initialization, asset, legacy byte, or backup effect; stale generation
  leaves no job/operation; client read-only calls require a stable non-empty
  observer header; server setup and observer responses require success status.
- Companion/overlap analysis: client and server owners observe opposite sides
  of the header boundary; the browser takeover performs live denied/revoked
  attempts.
- Action and rollback: retain the durable postconditions and exact status/header
  assertions.
- Validation: Fastify active writer 8/8, Fastify bootstrap 6/6, and client
  bootstrap 6/6 passed.
- Count delta: none.
- Revisit condition: add representative postconditions when another mutation
  family bypasses the shared pre-handler.

### TSA-P02-009: Browser storage and several oracle limits remain bounded

- State: Deferred with retained owners and explicit claim limits.
- Severity: Medium.
- Category: B, with Phase 13/14 horizontal ownership.
- Decision: Keep current evidence; add faithful proof at the revisit gate.
- Tests/cases: outbox/cross-tab suites, active-writer session cleanup,
  resource-manifest completeness, resource-cache aggregate pressure, and the
  visible local-settlement browser row.
- Production owner: real IndexedDB/Web Locks scheduling and failures, complete
  resource declaration/pressure, writer cleanup hooks, and authoritative
  visible settlement.
- Protected contract or plausible defect: fake IndexedDB and deterministic
  locks do not expose quota, blocked upgrades, versionchange, process death, or
  real multi-tab scheduling; three 30 ms negative waits are load-sensitive;
  manifest and loader can share a missing requirement; one visible toggle proves
  accepted local settlement rather than an authoritative reread; several
  cleanup spies and aggregate cache limits remain incomplete.
- Evidence: current unit tests retain exact transaction, encryption, CAS,
  ordering, projection, and coordinator evidence, and browser recovery covers
  real reload/response loss. Those companions do not justify broader claims.
- Companion/overlap analysis: no existing same-layer test replaces the retained
  cases. The residual is an addition/faithfulness need, not removal evidence.
- Action and rollback: keep current suites and their bounded wording. Add a real
  Chromium multi-page storage case with injectable open/write/upgrade failure,
  replace fixed negative waits with lock/transaction entry signals, add an
  independent consumer-read manifest oracle, finish cleanup spies and total
  cache pressure, and force an authoritative reread for the visible settlement
  claim.
- Validation: all current owning focused tests and the complete Phase 2 browser
  matrix pass; the inventory links every bounded owner to this finding.
- Count delta: none in the deferred item.
- Revisit condition: Phase 13 when cross-suite faithful-browser additions are
  consolidated, or Phase 14 before closeout if the browser harness gains
  multi-page persistent-context and IndexedDB failure injection sooner.
