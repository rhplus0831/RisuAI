# Test Suite Effectiveness Findings

Date: 2026-08-29

Status: Active; fifty-one findings are done, one remains confirmed, and four
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

## Phase 3 Findings

### TSA-P03-001: First-run classification ignores durable table families

- State: Done.
- Severity: Critical.
- Category: C.
- Decision: Strengthen, then Keep.
- Tests/cases: all nineteen `databaseInitialization.test.ts` cases.
- Production owner: `assessDatabaseInitialization()` before default seeding.
- Protected contract or plausible defect: malformed/missing settings plus
  collection, plugin, asset, memory, operation, or future user-state rows could
  be classified as fresh and overwritten by initialization.
- Evidence: the former query checked only characters, chats, messages, revision,
  and events. Real-SQLite counterexamples now cover missing/malformed settings
  with collection, plugin, storage, asset, and unknown future tables.
- Companion/overlap analysis: the missing-database filesystem guard runs before
  SQLite creation; it cannot replace row-level damaged-database classification.
- Action and rollback: discover every nontechnical SQLite table and fail closed
  on any row; separately fence positive revision/projection epochs.
- Validation: classifier 19/19, initialize integration 3/3, and server typecheck
  passed.
- Count delta: twelve cases added; no file delta.
- Revisit condition: update the explicit technical-row exemption only when a
  fresh schema intentionally seeds another non-user table.

### TSA-P03-002: Append-only generation accepts a stale same-length prefix

- State: Done.
- Severity: High.
- Category: C, with an F generation companion.
- Decision: Strengthen, then Keep.
- Tests/cases: 28 message-store cases plus the generation concurrency companion.
- Production owner: `appendActiveChatMessageTail()` and assembly persistence.
- Protected contract or plausible defect: a concurrent same-length transcript
  edit could receive a tail derived from stale initial messages because the fast
  path checked only active-row count.
- Evidence: the real-SQLite counterexample replaces the prefix without changing
  its length. A route-level embedding pause permits a concurrent edit and proves
  the stale tail is rejected while the newer transcript remains.
- Companion/overlap analysis: generic diff protects edit/truncate paths; the
  append fast path deliberately bypasses it and therefore needs its own prefix
  identity proof.
- Action and rollback: compare the live semantic transcript with the expected
  assembly-start prefix before any tail INSERT, retaining prefix rowids,
  alternates, and zero generic-diff work.
- Validation: focused three-file suite passed 241/241 and server typecheck passed.
- Count delta: one category-C case and one category-F companion added.
- Revisit condition: replace the semantic read only with an equally strong
  stored prefix certificate.

### TSA-P03-003: Module lorebook drafts ignore authoritative projections

- State: Done.
- Severity: High.
- Category: C.
- Decision: Strengthen, then Keep.
- Tests/cases: all 102 `lorebookBridge.svelte.test.ts` cases.
- Production owner: module lorebook pending replacements and collection epochs.
- Protected contract or plausible defect: a queued module draft could dispatch
  after authoritative module hydration replaced its optimistic baseline.
- Evidence: global, character, and chat scopes captured projection epochs;
  module scopes returned a sentinel whose change check was always false. The
  new case projects authoritative module content before debounce settlement and
  requires no stale command.
- Companion/overlap analysis: script definitions already fence module
  projections; lorebook ownership and payloads require their own bridge proof.
- Action and rollback: capture the modules collection epoch and apply the same
  stale-projection dispatch guard used by other lorebook scopes.
- Validation: 102/102 focused lorebook bridge cases passed.
- Count delta: one case added; no file delta.
- Revisit condition: move to a per-module row epoch if module hydration becomes
  independently addressable.

### TSA-P03-004: Bridge lifecycle teardown is not idempotent

- State: Done.
- Severity: Medium.
- Category: C.
- Decision: Strengthen, then Keep.
- Tests/cases: all three `bridgeFlush.test.ts` cases.
- Production owner: shared pagehide/visibility keepalive flush listeners.
- Protected contract or plausible defect: invoking one consumer's cleanup twice
  could decrement the global reference count twice and detach listeners still
  owned by another active consumer.
- Evidence: the former returned closure had no per-handle stopped flag. A
  two-owner counterexample double-stops the first handle, proves the second still
  flushes, and then proves final teardown removes both listeners.
- Companion/overlap analysis: individual bridge suites own payload/rollback;
  this file uniquely owns physical listener sharing.
- Action and rollback: make each teardown closure idempotent.
- Validation: 3/3 focused lifecycle-flush cases passed.
- Count delta: one case added; no file delta.
- Revisit condition: none unless listener ownership moves to a shared lifecycle
  registry.

### TSA-P03-005: Ordinary transaction and DELETE replay claims omit races

- State: Done.
- Severity: High.
- Category: C.
- Decision: Strengthen, then Keep.
- Tests/cases: 222 broad command cases, 12 receipt cases, and all 30 durable
  DELETE matrix cases.
- Production owner: `BEGIN IMMEDIATE` command mutations, persisted/live events,
  transactional receipts, and replay pre-handler.
- Protected contract or plausible defect: two ordinary same-base commands could
  both apply, event persistence could fail after domain state advanced, or a
  retried destructive request could execute again instead of replaying its
  original receipt.
- Evidence: the new race produces exactly one 200 and one 409 with one state,
  revision, event, and receipt. A trigger-backed event failure returns 500 and
  leaves none of those effects. Every DELETE family now reuses its first
  mutation ID and requires an identical response with no second effect.
- Companion/overlap analysis: initialization concurrency, receipt unit cases,
  and semantic second-delete intents protect different transaction boundaries.
- Action and rollback: retain the exact negative side-effect and physical
  receipt/event assertions.
- Validation: focused transaction rows, 30/30 DELETE cases, and the 580-case
  Phase 3 Fastify batch passed.
- Count delta: two command cases added; DELETE matrix count unchanged.
- Revisit condition: extend the race template when a command bypasses the shared
  mutation transaction.

### TSA-P03-006: Mutation budget discovery is regex-shaped

- State: Done.
- Severity: Medium.
- Category: C.
- Decision: Strengthen, then Keep.
- Tests/cases: all nine `commandMutationBudget.test.ts` cases.
- Production owner: runtime mutation-path to physical-table budget registry.
- Protected contract or plausible defect: double quotes, templates, or
  conditional shared-table references could evade the source regex and leave a
  runtime path without a review gate.
- Evidence: the AST counterexample covers literal, template, table, conditional,
  and intentional pass-through forms; complete production discovery still
  equals the gate map.
- Companion/overlap analysis: runtime metric cases prove selected routes; the
  static oracle uniquely proves registry completeness over all source owners.
- Action and rollback: use TypeScript syntax nodes rather than substring forms.
- Validation: 9/9 focused budget cases passed.
- Count delta: one case added; no file delta.
- Revisit condition: move the registry to production types if every emitter can
  share a closed union without circular ownership.

### TSA-P03-007: Receipt migration omits its replay payload oracle

- State: Done.
- Severity: Medium.
- Category: C.
- Decision: Strengthen, then Keep.
- Tests/cases: the v24 receipt migration within all nineteen `db.test.ts` cases.
- Production owner: receipt lineage migration and replay response preservation.
- Protected contract or plausible defect: migration could retain the receipt key
  and metadata while losing or changing the response required for replay.
- Evidence: the fixture inserted `response_json` but the post-migration SELECT
  omitted it. The test now asserts the exact persisted event/extra response.
- Companion/overlap analysis: current-schema replay tests cannot prove upgrade
  preservation from the v24 table shape.
- Action and rollback: keep the physical payload assertion with the migration.
- Validation: 19/19 focused schema/migration cases passed.
- Count delta: no case or file delta.
- Revisit condition: extend exact payload checks with any future receipt schema
  migration.

### TSA-P03-008: Historical and visible persistence fidelity remains bounded

- State: Deferred with retained owners and explicit claim limits.
- Severity: Medium.
- Category: C, with Phase 13/14 horizontal ownership.
- Decision: Keep current evidence; consolidate/add only at the revisit gate.
- Tests/cases: migration schemas, repeated range/bridge matrices, stable-ID
  editor paths, and visible multi-resource rollback companions.
- Production owner: real historical database upgrades, transient duplicate/index
  fail-closed behavior, mounted rollback paint, and multi-step browser replay.
- Protected contract or plausible defect: synthetic schemas may miss production
  era combinations; a transient reused editor row or duplicate owner remains
  less faithful than stable-ID APIs; mocked bridge outcomes do not render every
  optimistic/rollback state; repeated harnesses can drift.
- Evidence: current server command paths repair module IDs and reject ambiguous
  owners, so the exploration-only duplicate/index risks were not promoted to
  demonstrated High defects. Existing bridge tests prove resource-state
  ownership and rollback, and Phase 2 browser journeys prove generic durable
  replay, but neither closes these narrower fidelity gaps.
- Companion/overlap analysis: no same-layer owner is redundant; consolidation
  must retain domain payload, target, and physical-row distinctions.
- Action and rollback: add tracked historical SQLite fixtures when failures are
  available, prefer stable-ID editor APIs/fail-closed lookup, add representative
  mounted rollback and multi-step browser apply/replay, and consolidate only the
  generic deferred/receipt harness layers.
- Validation: all 52 Phase 3 owners pass 1,583/1,583 focused cases.
- Count delta: none in the deferred item.
- Revisit condition: Phase 13 cross-suite consolidation/addition review, then a
  mandatory Phase 14 residual check before closeout.

## Phase 4 Findings

### TSA-P04-001: Older overlapping hydration can replace newer transcript rows

- State: Done.
- Severity: High.
- Category: B after Phase 4 reclassification, with a D transcript seam.
- Decision: Strengthen, then Keep.
- Tests/cases: 71 `chatMessageHydration.test.ts` cases plus six reactive, six
  range-merge, and two retained-projection companions.
- Production owner: ranged transcript hydration and reactive retained messages.
- Protected contract or plausible defect: an older overlapping response could
  overwrite rows already supplied by a newer response.
- Evidence: deferred overlapping ranges reproduced the overwrite; response
  ownership now rejects stale overlap while still permitting disjoint
  placeholder fills.
- Companion/overlap analysis: pure range merge and reactive projection tests
  cover different layers and cannot replace request-generation ownership.
- Action and rollback: fence response ranges with generation ownership and
  retain the explicit stale-overlap/disjoint-fill counterexamples.
- Validation: focused hydration/reactivity/range tests passed 83/83; retained
  projection, the exact Phase 4 frontend set, and the complete frontend lane
  passed.
- Count delta: one case added; no file delta.
- Revisit condition: extend the range certificate if partial hydration becomes
  independently cancellable per message.

### TSA-P04-002: Original-layer edits retain an obsolete translation

- State: Done.
- Severity: High.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: `Chat.parserDependencies.test.ts` and the partial-edit layer and
  freshness companions.
- Production owner: partial message editing and raw/translated render layers.
- Protected contract or plausible defect: editing original text could leave a
  translation for the previous source displayed as if it were current.
- Evidence: the original-layer branch changed raw text but retained the
  translation; the counterexample now requires translation invalidation.
- Companion/overlap analysis: generic edit freshness protects target identity,
  not the semantic dependency between source and translation.
- Action and rollback: clear the derived translation with the source edit.
- Validation: focused parser/partial-edit owners and the full frontend lane
  passed.
- Count delta: no collected-case or file delta.
- Revisit condition: replace clearing only if translations gain a verifiable
  source-version certificate.

### TSA-P04-003: A failed final branch can leave an optimistic URL selected

- State: Done.
- Severity: High.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: all 54 `Chat.customHtml.test.ts` cases.
- Production owner: branch/fork creation, route selection, and rollback.
- Protected contract or plausible defect: after one fork succeeds and a later
  fork fails, the URL could remain on the failed optimistic target.
- Evidence: the new deferred sequence proves the final successful fork remains
  selected after the later failure.
- Companion/overlap analysis: pure chat-fork graph tests do not observe route
  history or the rendered branch action.
- Action and rollback: restore the last settled route target on fork failure.
- Validation: 54/54 owner cases and the complete frontend lane passed.
- Count delta: one case added; no file delta.
- Revisit condition: none unless branch routing becomes transaction-owned.

### TSA-P04-004: Lazy first-open accounting can pass on an earlier request

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: all eight `lazyFirstOpen.spec.ts` browser cases.
- Production owner: emitted lazy chunks and route/modal first-open transitions.
- Protected contract or plausible defect: a cumulative requested-path set could
  let a transition pass without issuing its own required request.
- Evidence: each transition now captures a fresh request checkpoint and proves
  its own required emitted assets and final visible state.
- Companion/overlap analysis: the structural manifest proves completeness;
  only the browser transition proves real request timing and presentation.
- Action and rollback: use per-transition request evidence throughout the route
  and modal sweeps.
- Validation: exact Phase 4 browser owners passed 13/13 and the complete smoke
  lane passed 34/34.
- Count delta: none.
- Revisit condition: keep the checkpoint helper aligned if Playwright request
  tracing moves to a shared fixture.

### TSA-P04-005: Hotkey resource guards are not proved through installation

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: all 12 `hotkey.resourceGuard.test.ts` cases.
- Production owner: installed document hotkey listener and guarded mutations.
- Protected contract or plausible defect: direct handler tests could pass while
  the document listener failed to compose the guard or event ownership.
- Evidence: a real document-dispatch counterexample now crosses the installed
  listener and asserts the guarded resource command.
- Companion/overlap analysis: navigation cases own key policy; this owner
  uniquely proves mutation-resource composition.
- Action and rollback: retain the installed-listener row with the direct matrix.
- Validation: 12/12 focused cases and the complete frontend lane passed.
- Count delta: one case added; no file delta.
- Revisit condition: migrate the row with any future hotkey event hub.

### TSA-P04-006: Global chat navigation accepts invalid numeric indices

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: all eight `globalApi.changeChatTo.test.ts` cases.
- Production owner: public global API chat selection.
- Protected contract or plausible defect: negative, oversized, fractional,
  `NaN`, or infinite input could project an invalid chat selection.
- Evidence: the earlier bounds check did not require a finite integer; the new
  table rejects all invalid numeric classes without mutation.
- Companion/overlap analysis: route parsing validates URL shapes, not direct
  global API calls.
- Action and rollback: require a finite integer in the live index range.
- Validation: 8/8 focused cases and the complete frontend lane passed.
- Count delta: five cases added; no file delta.
- Revisit condition: none unless the public API adopts stable chat IDs.

### TSA-P04-007: Highlight ranges omit intermediate text nodes

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: all three `highlight.test.ts` cases.
- Production owner: CSS Highlight range construction.
- Protected contract or plausible defect: a match spanning more than two text
  nodes could leave its middle content unhighlighted.
- Evidence: the multi-node counterexample fails the former start/end-only walk;
  the implementation now visits every intersecting text node.
- Companion/overlap analysis: parser token tests do not own DOM node ranges.
- Action and rollback: retain the compact all-node traversal and counterexample.
- Validation: 3/3 focused cases and the complete frontend lane passed.
- Count delta: one case added; no file delta.
- Revisit condition: sample actual painted ranges under the browser fidelity
  work in `TSA-P04-019`.

### TSA-P04-008: Removed active BGM remains attached

- State: Done.
- Severity: Medium.
- Category: D, with a Phase 7 media seam.
- Decision: Strengthen, then Keep.
- Tests/cases: all 12 `observer.svelte.test.ts` cases.
- Production owner: MutationObserver-owned BGM controls and active media.
- Protected contract or plausible defect: removing the active audio node could
  leave it playing and retain stale control ownership.
- Evidence: the new removal row requires pause and ownership cleanup before a
  later node can attach.
- Companion/overlap analysis: mocked media is appropriate for deterministic
  lifecycle calls; autoplay fidelity remains browser-owned.
- Action and rollback: stop and clear active media when its observed node leaves.
- Validation: 12/12 focused cases and the complete frontend lane passed.
- Count delta: one case added; no file delta.
- Revisit condition: real autoplay/removal sampling is routed to
  `TSA-P04-019`/Phase 7.

### TSA-P04-009: Bookmark navigation reports completion before queued routing

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: all seven `BookmarkList.svelte.test.ts` cases.
- Production owner: hydrated bookmark selection and queued message navigation.
- Protected contract or plausible defect: callers could observe success and
  close the dialog while the queued route had not settled or later failed.
- Evidence: the mounted deferred counterexample observes the returned promise
  before and after the queued route settles.
- Companion/overlap analysis: resource-guard bookmark edits protect optimistic
  list state, not route settlement.
- Action and rollback: return and await the queued navigation operation.
- Validation: 7/7 focused cases and the complete frontend lane passed.
- Count delta: one case added; no file delta.
- Revisit condition: none unless bookmark routing gains a durable receipt.

### TSA-P04-010: Shared Button implicitly submits ancestor forms

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Add, then Keep.
- Tests/cases: the new one-case `Button.svelte.test.ts` owner.
- Production owner: generic shared GUI Button native semantics.
- Protected contract or plausible defect: a non-submit action inside a form
  defaults to submit and triggers an unrelated save or destructive action.
- Evidence: the mounted ancestor-form counterexample observes an unintended
  submit before the component declares `type="button"`.
- Companion/overlap analysis: caller tests cannot exhaustively prove the safe
  default of a widely reused primitive.
- Action and rollback: set the native safe default in the shared component.
- Validation: focused owner and the complete frontend lane passed.
- Count delta: one file and one case added.
- Revisit condition: add an explicit submit variant only when intentionally
  required by a caller.

### TSA-P04-011: Seasonal Title interval survives unmount

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: all three `Title.svelte.test.ts` cases.
- Production owner: seasonal global title lifecycle.
- Protected contract or plausible defect: remounts could accumulate intervals
  and continue updating detached UI.
- Evidence: fake timers now prove the interval is cleared at teardown.
- Companion/overlap analysis: native-link/button semantics do not prove cleanup.
- Action and rollback: register interval disposal with component teardown.
- Validation: 3/3 focused cases and the complete frontend lane passed.
- Count delta: one case added; no file delta.
- Revisit condition: none.

### TSA-P04-012: Persisted attachment preview extensions are case-sensitive

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: both `AssetInput.svelte.test.ts` cases.
- Production owner: persisted attachment preview classification.
- Protected contract or plausible defect: an image with an uppercase or mixed
  extension could lose its preview after persistence/reload.
- Evidence: the new mounted row supplies a mixed-case persisted name and
  requires the image preview path.
- Companion/overlap analysis: upload MIME handling does not cover later
  filename-only rendering.
- Action and rollback: normalize the extracted extension before classification.
- Validation: 2/2 focused cases and the complete frontend lane passed.
- Count delta: one case added; no file delta.
- Revisit condition: prefer stored MIME metadata if the asset schema adds it.

### TSA-P04-013: Unread state is incorrectly coupled to auto-scroll

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: 97 `DefaultChatScreen.loadPages.test.ts` cases plus four pure
  unread cases.
- Production owner: visible generated-message arrival and unread bookkeeping.
- Protected contract or plausible defect: a reply arriving outside the visible
  transcript could remain marked read merely because auto-scroll was disabled.
- Evidence: mounted rows now separate visibility/unread intent from scroll
  policy and require unseen generated replies to become unread.
- Companion/overlap analysis: the pure helper owns state transitions; the broad
  mounted coordinator proves the actual arrival path.
- Action and rollback: compute unread from visibility/ownership independently
  of auto-scroll.
- Validation: focused owners and the complete frontend lane passed.
- Count delta: two cases added; no file delta.
- Revisit condition: add intersection-observer fidelity with the real send
  journey in `TSA-P04-019`.

### TSA-P04-014: Saving feedback omits its idle transition

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: all three `SavePopupIcon.svelte.test.ts` cases.
- Production owner: global persistence activity feedback.
- Protected contract or plausible defect: a stale success icon could remain
  visible after neither saving nor saved state applies.
- Evidence: the missing idle row now requires no stale indicator.
- Companion/overlap analysis: persistence-activity state tests do not render the
  shared icon.
- Action and rollback: retain the explicit saving/saved/idle state matrix.
- Validation: 3/3 focused cases and the complete frontend lane passed.
- Count delta: one case added; no file delta.
- Revisit condition: extend the matrix if failure gains a separate visible state.

### TSA-P04-015: Icon accessibility policy depends on raw source strings

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Strengthen, then Keep.
- Tests/cases: four `AccessibleIconActions.test.ts` policy cases covering nine
  controls, plus mounted editor action companions.
- Production owner: shared icon native-interaction and accessible-name policy.
- Protected contract or plausible defect: raw string checks could pass on a
  comment/noninteractive node or fail after an equivalent Svelte refactor.
- Evidence: the replacement parses the modern Svelte AST and requires each icon
  to have a native interactive ancestor and accessible-name source.
- Companion/overlap analysis: mounted owners prove selected computed names and
  activation; the AST owner cheaply enforces breadth without claiming a browser
  accessibility tree.
- Action and rollback: retain the AST policy and its nine-control inventory.
- Validation: accessible/editor owners passed 15/15; the complete frontend lane
  passed.
- Count delta: none.
- Revisit condition: add mounted proof when a listed control lacks any rendered
  companion or adopts non-native interaction.

### TSA-P04-016: MobileControls tests an unmounted legacy shell

- State: Done.
- Severity: Medium.
- Category: D.
- Decision: Remove after complete replacement proof.
- Tests/cases: removed two-case `MobileControls.svelte.test.ts` and orphaned
  `MobileControls.testState.ts`.
- Production owner: none; `App.svelte` explicitly does not mount the tested
  `MobileHeader`/`MobileBody` shell.
- Protected contract or plausible defect: the test could not fail for a live
  responsive-navigation regression because its component tree is unreachable.
- Evidence: import/mount tracing proved the obsolete tree; mounted App route and
  focus, Sidebar keyboard, live `MobileCharacters`, and compiled responsive
  browser tests retain the current behavior.
- Companion/overlap analysis: `MobileControls.testStub.svelte` remains because
  the live MobileCharacters owner consumes it.
- Action and rollback: delete only the obsolete test and its orphaned state;
  preserve all reachable replacement owners and documentation.
- Validation: replacement frontend owners passed 35/35, full frontend passed
  6,693/6,693, and browser smoke passed 34/34.
- Count delta: one file and two cases removed; one standalone support artifact
  removed.
- Revisit condition: add coverage for a future mobile shell only where App
  actually mounts it.

### TSA-P04-017: Runtime directories obscure dominant product risk

- State: Done.
- Severity: Medium.
- Category: A/B/D/F/G/K/L.
- Decision: Reclassify.
- Tests/cases: nine outgoing D owners with 279 cases and incoming
  `src/lang/index.test.ts` with 11 cases; the observer B-to-D correction from
  Phase 2 is finalized here.
- Production owner: assurance import policy, hydration, generation requests,
  provider dispatch, import planning, login-origin security, localization, and
  DOM/media lifecycle respectively.
- Protected contract or plausible defect: directory-shaped routing would audit
  provider, security, generation, and recovery evidence under shared UI and
  could miss its real companions.
- Evidence: explicit product-risk rules and unit counterexamples now route all
  named owners to their dominant category while preserving seam tags.
- Companion/overlap analysis: reclassification changes review ownership only;
  no runtime lane, discovery, or test is removed.
- Action and rollback: retain all owners under the corrected A/B/D/F/G/K/L map.
- Validation: inventory rule tests, exact Phase 4 frontend 1,142/1,142, and
  reclassified Fastify 106/106 passed; inventories check at 699/699.
- Count delta: none.
- Revisit condition: update explicit rules only when dominant production risk
  changes, not when a file moves directories.

### TSA-P04-018: Regeneration retains metadata for deleted test owners

- State: Done.
- Severity: Medium.
- Category: A assurance infrastructure.
- Decision: Strengthen, then Keep.
- Tests/cases: all eight `test-effectiveness-inventory.test.ts` cases.
- Production owner: exhaustive effectiveness-inventory regeneration.
- Protected contract or plausible defect: deleting a tracked test could leave
  preserved case/audit metadata attached to a nonexistent owner or a later file.
- Evidence: a temporary Git repository now deletes one tracked test and proves
  regeneration emits only the surviving row.
- Companion/overlap analysis: discovery checks catch file-set drift but did not
  prove preserved metadata pruning.
- Action and rollback: seed preserved metadata only for currently tracked rows.
- Validation: focused utility owner and `check:test-inventories` passed.
- Count delta: one case added; no file delta.
- Revisit condition: extend the deletion row if inventory keys ever cease to be
  repository-relative paths.

### TSA-P04-019: Visible UI fidelity remains intentionally bounded

- State: Deferred with retained owners and explicit claim limits.
- Severity: Medium.
- Category: D, with F/G/L and Phase 13/14 horizontal ownership.
- Decision: Keep current evidence; add faithful proof at the revisit gate.
- Tests/cases: composer/send/attachment owners, alert/onboarding/focus owners,
  responsive/viewport tests, browser specs, and the six-owner UI coverage map.
- Production owner: visible send/attach/stream/abort/reload, true mobile input,
  cross-browser focus/file behavior, stacked dialogs, onboarding, full-screen
  accessibility, and representative coverage mapping.
- Protected contract or plausible defect: Happy DOM and resized Chromium do not
  prove a real typed attachment send through streaming, touch keyboard/selection,
  Firefox/WebKit focus/file behavior, complete alert stacks, or broad screen
  accessibility; the low-threshold map is a sentinel rather than full UI proof.
- Evidence: the phase retained strong pure, mounted, AST, and compiled-Chromium
  layers and removed only unreachable legacy coverage. Those layers do not
  justify the broader fidelity claims.
- Companion/overlap analysis: current browser send recovery uses API/helper
  setup, and current responsive smoke uses Desktop Chromium plus deterministic
  viewport emulation; neither makes the requested additions redundant.
- Action and rollback: in Phase 13 add a visible composer attach/send/stream/
  abort/reload journey, true mobile/touch and targeted Firefox/WebKit projects,
  stacked alert/onboarding/accessibility scans, and a deliberately expanded UI
  map without replacing focused owners.
- Validation: current exact and full frontend/browser/UI-map gates pass; this
  finding deliberately bounds what they prove.
- Count delta: none in the deferred item.
- Revisit condition: Phase 13 consolidation/addition review, followed by a
  mandatory Phase 14 residual decision before closeout.
