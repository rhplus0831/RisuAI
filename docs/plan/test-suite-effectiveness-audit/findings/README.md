# Test Suite Effectiveness Findings

Date: 2026-08-29

Status: Active; 130 findings are done and 11 are deferred with concrete revisit
triggers.

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

- State: Done in Phase 5; historical failure did not reproduce.
- Severity: Medium.
- Category: E, with B/C seams.
- Decision: Keep the regression owner and close the suspected current defect.
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
- Action and rollback: retained the complete regression owner unchanged. The
  production projection path explicitly reasserts pending structural mutations
  before dirty-field reconciliation, so no speculative product change landed.
- Validation: the named case passed in isolation, in the Phase 5 exact 898-case
  frontend set, and in the preceding complete 6,693-case frontend run.
- Count delta: None.
- Revisit condition: reopen only on a reproducible failure with a captured seed
  or ordering trace.

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

## Phase 5 Findings

### TSA-P05-001: Rejected model-preset selection locks its row

- State: Done.
- Severity: High.
- Category: E, with a Phase 7 model seam.
- Decision: Strengthen, then Keep.
- Tests/cases: all six `ModelPresetList.svelte.test.ts` cases.
- Production owner: model-preset selection feedback and retry state.
- Protected contract or plausible defect: an unexpected rejected adapter
  promise could leave `selectionPendingIndex` set forever, preventing every
  later preset selection.
- Evidence: the mounted rejection counterexample now requires the busy state to
  clear, the existing error to appear, and a second selection to succeed.
- Companion/overlap analysis: explicit `{ status: 'failed' }` coverage did not
  execute a rejected promise; storage command tests do not prove the row UI.
- Action and rollback: catch the rejection at the component boundary and reuse
  the existing localized failure path.
- Validation: 6/6 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: one case added; no file delta.
- Revisit condition: none unless selection gains cancellation semantics.

### TSA-P05-002: Dynamic model catalog rejection escapes the settings effect

- State: Done.
- Severity: High.
- Category: E/G.
- Decision: Strengthen, then Keep.
- Tests/cases: all eight `ModelProviderPanel.svelte.test.ts` cases.
- Production owner: LLM Gateway and Neuralwatt catalog loading in the profile
  editor.
- Protected contract or plausible defect: a network rejection could escape as
  an unhandled promise and leave the provider panel without a settled recovery
  contract.
- Evidence: both providers now settle to the existing empty-catalog message,
  clear the spinner, and retain an editable manual model field.
- Companion/overlap analysis: provider helper retries do not prove the mounted
  editor's loading and fallback state.
- Action and rollback: consume the rejection before `finally`; do not invent a
  second error surface where `ModelGrid` already owns unavailable feedback.
- Validation: 8/8 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: two cases added; no file delta.
- Revisit condition: add differentiated error text only if the product exposes
  retry diagnostics to users.

### TSA-P05-003: Imported module media extension is compared case-sensitively

- State: Done.
- Severity: High.
- Category: E, with J/K seams.
- Decision: Strengthen, then Keep.
- Tests/cases: all six `ModuleMenu.svelte.test.ts` cases.
- Production owner: persisted module-asset preview dispatch.
- Protected contract or plausible defect: imported `MP4` or `MP3` metadata
  could render valid media as an image after reload.
- Evidence: the mounted uppercase-MP4 fixture now requires a video source with
  `video/mp4` and no image fallback.
- Companion/overlap analysis: upload-time extension normalization does not
  cover metadata preserved from imported modules.
- Action and rollback: lowercase persisted extension metadata at preview
  classification without rewriting the imported filename.
- Validation: 6/6 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: one case added; no file delta.
- Revisit condition: prefer stored content type if the asset schema adds it.

### TSA-P05-004: Persona settings dereferences a disappeared selected owner

- State: Done.
- Severity: High.
- Category: E.
- Decision: Add, then Keep.
- Tests/cases: the new one-case `PersonaSettings.svelte.test.ts` owner.
- Production owner: selected-persona avatar and portrait controls during
  authoritative projections.
- Protected contract or plausible defect: removing or replacing the selected
  row could throw while the settings page rendered its portrait mode.
- Evidence: an empty authoritative persona collection now mounts safely while
  retaining the page and its portrait control.
- Companion/overlap analysis: pure persona projection tests normalize state but
  did not render the unsafe expressions.
- Action and rollback: use fail-closed optional portrait reads and add the
  missing mounted page owner.
- Validation: 1/1 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: one file and one case added.
- Revisit condition: expand this owner when more PersonaSettings-only visual
  behavior is changed.

### TSA-P05-005: Catalog actions settle after their component is disposed

- State: Done.
- Severity: High.
- Category: E/D.
- Decision: Strengthen, then Keep.
- Tests/cases: all 14 `GridCatalog.svelte.test.ts` cases.
- Production owner: durable remove, restore, and permanent-delete feedback in
  the character catalog.
- Protected contract or plausible defect: a queued or failed action could
  mutate disposed state and raise a stale notification after navigation.
- Evidence: the deferred mounted action is resolved after unmount and now
  produces neither state work nor alert.
- Companion/overlap analysis: command outcomes prove persistence but not
  component lifetime ownership.
- Action and rollback: fence both success and rejection continuations with the
  component lifecycle.
- Validation: 14/14 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: one case added; no file delta.
- Revisit condition: none unless actions become externally cancellable.

### TSA-P05-006: Realm removal lacks an explicit non-owner counterexample

- State: Done.
- Severity: High.
- Category: E/L.
- Decision: Strengthen, then Keep.
- Tests/cases: all 14 `RealmPopUp.svelte.test.ts` cases.
- Production owner: projected Realm account/card ownership at the removal UI.
- Protected contract or plausible defect: a truthy creator ID could expose a
  destructive action to a different signed-in account.
- Evidence: the mounted mismatch row with two distinct IDs hides removal while
  retaining the report action.
- Companion/overlap analysis: server authorization remains authoritative; the
  client guard separately prevents misleading destructive affordances.
- Action and rollback: retain production behavior and add the missing negative
  authorization fixture.
- Validation: 14/14 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: one case added; no file delta.
- Revisit condition: update the fixture if Realm adopts delegated ownership.

### TSA-P05-007: Mobile character rows resolve a recycled array index

- State: Done.
- Severity: High.
- Category: E/D.
- Decision: Strengthen, then Keep.
- Tests/cases: both `MobileCharacters.svelte.test.ts` cases.
- Production owner: mobile character open/create actions.
- Protected contract or plausible defect: a rendered ID-backed row could open
  the replacement occupant of its old index after a collection projection.
- Evidence: normal navigation resolves the current chat by stable character ID;
  replacing the collection before activation now fails closed, and creation is
  exercised through its native button.
- Companion/overlap analysis: pure row formatting and desktop catalog actions
  do not prove the mobile handler's target resolution.
- Action and rollback: re-resolve ID-backed rows against the current collection
  and retain the legacy index fallback only for ID-less characters.
- Validation: 2/2 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: one case added; no file delta.
- Revisit condition: remove the legacy fallback when all characters have IDs.

### TSA-P05-008: Authoring-shaped names hide security, prompting, and bytes

- State: Done.
- Severity: Medium.
- Category: E/F/K/L.
- Decision: Reclassify.
- Tests/cases: `hub.test.ts` (28) to L, `lorebook.test.ts` (78) and
  `agentLorebookInputs.test.ts` (5) to F, and
  `characterCards.pngImport.svelte-node.test.ts` (21) to K.
- Production owner: Realm authentication/limits, lorebook prompt activation,
  Agent input resolution, and PNG/CharX byte formats.
- Protected contract or plausible defect: reviewing these 132 cases as editor
  UI could miss their dominant security, runtime prompt, or format companions.
- Evidence: executable exact-path counterexamples now route each file by
  product risk while seam tags preserve its authoring relationship.
- Companion/overlap analysis: reclassification changes only audit ownership;
  every test and runtime lane remains intact.
- Action and rollback: retain the four owners under L/F/K and do not repeat
  their complete file disposition later.
- Validation: inventory rule tests and all 125 Phase 5 Fastify cases passed;
  frontend reclassified owners passed in the 898-case exact set.
- Count delta: none.
- Revisit condition: only if the dominant protected contract changes.

### TSA-P05-009: Hotkey modifier controls have presentation-only coverage

- State: Done.
- Severity: High.
- Category: E.
- Decision: Strengthen, then Keep.
- Tests/cases: all nine `HotkeySettings.svelte.test.ts` cases.
- Production owner: hotkey modifier authoring and settings-bridge patches.
- Protected contract or plausible defect: Ctrl, Shift, or Alt could toggle the
  wrong field or erase sibling modifiers while accessible-state checks pass.
- Evidence: a three-row mounted matrix activates each control and requires the
  exact cloned setting patch.
- Companion/overlap analysis: installed hotkey behavior from Phase 4 proves
  consumption, not this authoring bridge.
- Action and rollback: retain production behavior and add interaction proof.
- Validation: 9/9 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: three parameterized cases added; no file delta.
- Revisit condition: add Meta when it becomes a supported persisted modifier.

### TSA-P05-010: Persona icon upload lacks owner-replacement proof

- State: Done.
- Severity: High.
- Category: E, with a K seam.
- Decision: Strengthen, then Keep.
- Tests/cases: all ten `persona.iconUpload.test.ts` cases.
- Production owner: selected-persona icon freshness after asset persistence.
- Protected contract or plausible defect: late icon bytes could patch a new
  persona that occupied the selected index after owner replacement.
- Evidence: replacing the row while upload is pending now leaves its icon and
  legacy mirror unchanged, emits no persona command, and reports stale input.
- Companion/overlap analysis: selection-change coverage left the original row
  present; server freshness helpers do not prove the client application path.
- Action and rollback: retain the existing stable-ID guard and add the missing
  replacement counterexample.
- Validation: 10/10 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: one case added; no file delta.
- Revisit condition: immediate orphan cleanup remains in `TSA-P05-013`.

### TSA-P05-011: BotSettings icon policy depends on source formatting

- State: Done.
- Severity: Medium.
- Category: E/D.
- Decision: Strengthen, then Keep.
- Tests/cases: all 20 `BotSettings.accessibility.test.ts` cases, including nine
  icon contracts.
- Production owner: direct settings-control names and static persistence policy.
- Protected contract or plausible defect: exact substrings could pass in a
  comment or fail after equivalent formatting without proving an icon belongs
  to the named native button.
- Evidence: the modern Svelte AST now binds every intended expression to one
  native icon button.
- Companion/overlap analysis: mounted settings owners remain responsible for
  computed names and activation; the AST cheaply retains broad policy.
- Action and rollback: replace only the icon substring matrix; retain distinct
  visibility and lifecycle policy checks until stronger owners replace them.
- Validation: 20/20 focused and 898/898 exact Phase 5 frontend cases passed.
- Count delta: none.
- Revisit condition: Phase 13 may replace remaining source slices only with
  mounted or structural counterexamples for the same contracts.

### TSA-P05-012: Phase 5 evidence layers remain distinct

- State: Done.
- Severity: Informational.
- Category: E with C/D/F/G/I/J/K/L seams.
- Decision: Keep.
- Tests/cases: the complete 97-file, 1,023-case reviewed set.
- Production owner: settings shells and controls, profiles and presets, persona
  and character authoring, lorebooks, modules/plugins, Realm/catalogs, and
  their durable bridge companions.
- Protected contract or plausible defect: merging by page name or file size
  would erase distinct validation, stable-ID, reorder, settlement, rendered
  feedback, server normalization, or authorization failures.
- Evidence: every file has a named contract in `inventory.json`; focused pure,
  mounted, Svelte+Node, and Fastify layers fail at different boundaries. No
  complete-file removal proof was established.
- Companion/overlap analysis: mega-suites contain cohesive state-machine owners
  or share expensive fixtures; split proposals are not justified by size alone.
- Action and rollback: retain all reviewed live owners, the new persona owner,
  and all corrected-category owners. No test was merged or removed.
- Validation: exact frontend passed 898/898 across 93 files; exact Fastify
  passed 125/125 across four files.
- Count delta: one owner and twelve cases added during Phase 5.
- Revisit condition: use `TSA-P05-013` for additions; reconsider a retained
  owner only with full replacement/removal proof.

### TSA-P05-013: Authoring composition and stale asset cleanup remain bounded

- State: Deferred with retained owners and explicit phase ownership.
- Severity: High.
- Category: E, with D/G/K/L and Phase 11/13/14 ownership.
- Decision: Keep current evidence; add cleanup and composition proof at the
  named gates.
- Tests/cases: InputHook, DisplaySettings, UserSettings, RequestHistory,
  ProviderCredential, module/settings/persona/character media upload owners,
  Settings shell, and their durable bridge companions.
- Production owner: immediate cleanup of successfully saved but stale media,
  real settings-route/page composition, backup restore, request-history client
  transport, and rendered accepted/queued/failed authoring feedback.
- Protected contract or plausible defect: upload helpers save bytes before a
  final freshness check, so module, settings-media, persona-icon, and character
  notification operations can leave unreferenced assets until later GC. Broad
  page tests can also stay green through self-fulfilling draft/renderer mocks.
- Evidence: direct control-flow review identified the save-then-stale-return
  windows; no safe client deletion primitive exists, and GC intentionally has a
  one-hour grace period. Current mounted and bridge owners prove their bounded
  contracts but not a real multi-page backup/input-hook/request-history journey.
- Companion/overlap analysis: Phase 11 owns asset lifecycle and atomic import;
  Phase 7 owns provider/request transport; Phase 13 owns browser composition.
  None makes the current focused regression owners removable.
- Action and rollback: Phase 11 must design immediate cleanup or transactional
  asset adoption for the named upload paths. Phase 13 must add a representative
  settings authoring/restore journey and replace only demonstrably redundant
  source/mock assertions. Phase 14 makes the final residual decision.
- Validation: all current exact Phase 5 owners pass; the finding deliberately
  limits broader cleanup and composition claims.
- Count delta: none in the deferred item.
- Revisit condition: Phase 11 asset audit, Phase 13 consolidation, and mandatory
  Phase 14 closeout decision.

## Phase 6 Findings

### TSA-P06-001: Surviving multimodal prompt rows lose token cost

- State: Done.
- Severity: High.
- Category: F.
- Decision: Strengthen, then Keep.
- Tests/cases: complete client `finalizeRequestBudget.test.ts` and Fastify
  `budgetFinalize.test.ts` owners.
- Production owner: client and Fastify final prompt budget trimming.
- Protected contract or plausible defect: trimming text from a row that retains
  image/audio content could subtract the entire original row cost, dispatching
  input plus output beyond the context limit.
- Evidence: multimodal rows now retain non-text and row-overhead cost; only
  completely removed rows release the whole cost. Both owners re-tokenize the
  returned prompt and require the context inequality.
- Companion/overlap analysis: client and Fastify implementations are separate
  dispatch boundaries, so neither regression owner substitutes for the other.
- Action and rollback: subtract only removed text for surviving rows and the
  full cost for removed rows. Revert is isolated to budget accounting.
- Validation: 6/6 client and 9/9 Fastify budget cases passed; exact and complete
  lanes passed.
- Count delta: one client case added; no file delta.
- Revisit condition: unify the walkers only with semantic parity proof.

### TSA-P06-002: Accepted-send response loss lacked browser proof

- State: Done.
- Severity: High.
- Category: F, with B/C seams.
- Decision: Strengthen, then Keep.
- Tests/cases: all ten `acceptedSendProtocol.spec.ts` browser journeys.
- Production owner: accepted operation identity, lifecycle reconciliation, and
  durable transcript finalization after transport response loss.
- Protected contract or plausible defect: the server can accept a send while
  the browser loses its response, allowing retry to duplicate provider billing
  or leaving the accepted reply undiscoverable.
- Evidence: the browser now aborts the operation response before identity is
  visible, emits lifecycle recovery events, and observes one provider call and
  one correct terminal reply.
- Companion/overlap analysis: unit recovery state and Fastify idempotency do not
  prove composed browser reconciliation.
- Action and rollback: retain the production protocol and add the missing
  controlled loss journey.
- Validation: 11/11 exact Phase 6 browser cases passed.
- Count delta: one browser case added; no file delta.
- Revisit condition: automatic no-lifecycle probing remains `TSA-P06-013`.

### TSA-P06-003: Route-backed prompt fixtures did not assert dispatch semantics

- State: Done.
- Severity: High.
- Category: F.
- Decision: Strengthen, then Keep.
- Tests/cases: all 27 `sendChat.fixtures.serverBacked.test.ts` cases.
- Production owner: client fixture inputs through the Fastify preview/dispatch
  prompt formatter.
- Protected contract or plausible defect: both local and route paths could
  return plausible object shapes while differing in model-visible row order or
  content.
- Evidence: each route-backed fixture now compares the actual formatted prompt
  to its semantic local expectation, normalizing only empty optional attributes
  and thoughts.
- Companion/overlap analysis: generic local goldens and exact server preview
  tests remain distinct; no golden was changed.
- Action and rollback: retain the fixtures with semantic comparison.
- Validation: 27/27 focused cases and complete lanes passed.
- Count delta: none.
- Revisit condition: update normalization only for an intentional provider-
  visible compatibility decision.

### TSA-P06-004: Client lore injection combinations were implicit

- State: Done.
- Severity: High.
- Category: F, with E seams.
- Decision: Strengthen, then Keep.
- Tests/cases: all 16 `buildLorebookContext.test.ts` cases.
- Production owner: client lore activation, ordering, positioning, and content
  combination before prompt rendering.
- Protected contract or plausible defect: append/prepend/replace modes or mixed
  positions could silently omit or reorder activated lore.
- Evidence: parameterized combined fixtures require append, prepend, replace,
  stable ordering, and intended prompt positions.
- Companion/overlap analysis: Fastify lore activation proves server semantics;
  it does not execute the client builder.
- Action and rollback: retain the expanded semantic matrix.
- Validation: 16/16 focused cases and exact/complete lanes passed.
- Count delta: four cases, including three parameterized rows, added.
- Revisit condition: add a mode only when it becomes supported input.

### TSA-P06-005: Retrieved prompt descriptions lacked placement proof

- State: Done.
- Severity: High.
- Category: F.
- Decision: Strengthen, then Keep.
- Tests/cases: all nine `buildDescription.test.ts` cases.
- Production owner: parsed `additionalInformations` placement in assembled
  prompt descriptions.
- Protected contract or plausible defect: retrieved descriptions could parse
  but land in the wrong prompt position or disappear during combination.
- Evidence: the added fixture requires parser output and exact placement among
  surrounding description rows.
- Companion/overlap analysis: retrieval and parser unit owners do not prove the
  final prompt builder's use of their output.
- Action and rollback: retain the combined placement regression.
- Validation: 9/9 focused and complete frontend cases passed.
- Count delta: one case added.
- Revisit condition: none unless the prompt schema changes.

### TSA-P06-006: Parent Agent cancellation is reported as timeout

- State: Done.
- Severity: High.
- Category: F.
- Decision: Strengthen, then Keep.
- Tests/cases: all 25 Fastify `agentPresetExecution.test.ts` cases.
- Production owner: Agent Preset phase execution and parent abort propagation.
- Protected contract or plausible defect: user cancellation during a phase
  could be converted into a timeout failure, producing false diagnostics and
  the wrong terminal contract.
- Evidence: an externally aborted execution now propagates its abort reason;
  the timeout path remains distinct.
- Companion/overlap analysis: client Stop UI cannot prove server executor
  disposition.
- Action and rollback: propagate the parent signal reason through phase abort.
- Validation: 25/25 focused and complete Fastify cases passed.
- Count delta: one case added.
- Revisit condition: none.

### TSA-P06-007: Agent output keys can be ambiguous across phases

- State: Done.
- Severity: High.
- Category: F.
- Decision: Strengthen, then Keep.
- Tests/cases: all 11 `agentPresetResolver.test.ts` cases with the complete
  `agentPresetRecords` schema companion.
- Production owner: Agent Preset record validation and output-key resolution.
- Protected contract or plausible defect: the same key in execution and output
  phases could resolve differently by traversal order and compose the wrong
  value.
- Evidence: validation now requires output-key uniqueness across both phases;
  the cross-phase duplicate counterexample fails closed.
- Companion/overlap analysis: the resolver consumes records after validation;
  its happy paths alone did not own ambiguity rejection.
- Action and rollback: enforce record-wide key uniqueness.
- Validation: 25/25 records/resolver cases and complete frontend passed.
- Count delta: no collected-case delta; an existing matrix gained the
  counterexample.
- Revisit condition: introduce explicit qualified keys before allowing reuse.

### TSA-P06-008: A terminal post-generation run clears later progress

- State: Done.
- Severity: High.
- Category: F.
- Decision: Strengthen, then Keep.
- Tests/cases: all three `postGenerationProgress.test.ts` cases and the durable
  server-chat companion.
- Production owner: phase/run-scoped post-generation progress projection.
- Protected contract or plausible defect: completion of an earlier run could
  clear a later live run, while stale terminal events could overwrite current
  visible progress.
- Evidence: sessions remain live across run terminals, phase/run ordering fences
  stale terminals, and clearing happens only at session termination.
- Companion/overlap analysis: server event order does not prove client
  projection across multiple runs.
- Action and rollback: retain the session and clear it at the true terminal
  boundary.
- Validation: 79/79 focused progress/server-chat cases passed.
- Count delta: none; the existing state-machine case was extended.
- Revisit condition: none unless concurrent runs become supported.

### TSA-P06-009: Expanded character depth prompts bypass preflight budget

- State: Done.
- Severity: High.
- Category: F.
- Decision: Strengthen, then Keep.
- Tests/cases: all 17 client and 28 Fastify preflight cases.
- Production owner: client and server template expansion before context-limit
  admission.
- Protected contract or plausible defect: `depth_prompt` content could expand
  after preflight and overflow the provider context despite a green estimate.
- Evidence: both implementations include the expanded depth prompt in
  preflight token demand.
- Companion/overlap analysis: final trimming is a second boundary and cannot
  make an under-counting preflight truthful.
- Action and rollback: account for depth-prompt expansion in both walkers.
- Validation: 45/45 focused and complete lanes passed.
- Count delta: two cases added.
- Revisit condition: Phase 13 may unify walkers only with parity fixtures.

### TSA-P06-010: Early SSE consumer return leaves its reader locked

- State: Done.
- Severity: High.
- Category: F, with L seams.
- Decision: Strengthen, then Keep.
- Tests/cases: all 12 `sseParse.test.ts` cases.
- Production owner: client SSE reader lifecycle and fragmented event parsing.
- Protected contract or plausible defect: a consumer that stops before EOF can
  leave a network reader locked; pending abort/fragment boundaries could also
  strand iteration.
- Evidence: iteration distinguishes natural close and cancels the reader on
  early return. Split UTF-8, split CRLF, pending abort, and early-return
  counterexamples are retained.
- Companion/overlap analysis: Fastify stream tests own server framing and
  backpressure, not browser reader release.
- Action and rollback: cancel the reader in generator cleanup unless it closed
  naturally.
- Validation: 88/88 focused SSE/server-chat cases passed.
- Count delta: four cases added.
- Revisit condition: none unless transport moves away from streams.

### TSA-P06-011: Prompt-shaped names hide nine product-risk categories

- State: Done.
- Severity: Medium.
- Category: F to A/B/C/D/E/G/I/K/L.
- Decision: Reclassify.
- Tests/cases: 18 complete owners and 430 cases listed by
  `phase6-reclassified` state in `inventory.json`.
- Production owner: raw-generation policy, template hydration/bridges,
  settings/UI, tokenizer/provider completion, variables, asset upload, abort,
  and backpressure.
- Protected contract or plausible defect: reviewing these owners only as
  prompting hides their dominant architecture, UI, persistence, provider,
  parser, asset, or runtime companions.
- Evidence: exact-path counterexamples route every owner; tokenizer/completion
  owners now join the canonical Phase 7 set.
- Companion/overlap analysis: lane execution and seam tags are unchanged.
- Action and rollback: retain every owner under its corrected category.
- Validation: 8/8 routing-policy cases plus complete lanes passed.
- Count delta: one assurance-policy counterexample added; no owner delta.
- Revisit condition: only if a file's dominant protected contract changes.

### TSA-P06-012: Prompt and generation evidence layers remain distinct

- State: Done.
- Severity: Informational.
- Category: F with B/C/E/G/I/L seams.
- Decision: Keep.
- Tests/cases: the complete 93-file, 1,936-case reviewed opening set.
- Production owner: model-visible prompt inputs through dispatch, response
  parsing, durable finalization, effects, visible projection, and reload.
- Protected contract or plausible defect: merging by shared vocabulary would
  erase distinct client/server semantic drift, transport cleanup, durable
  identity, mounted projection, and browser recovery failures.
- Evidence: every file has a named complete contract in `inventory.json`; no
  owner met the mandatory replacement/removal proof.
- Companion/overlap analysis: pure, DOM, Svelte+Node, Fastify, and browser
  layers fail at different boundaries. Local trigger/Lua fixture doubles retain
  distinct Phase 9 runtime companions.
- Action and rollback: retain all reviewed owners and corrected-category
  companions; no test was merged or removed.
- Validation: 1,936/1,936 exact opening-owner cases passed after remediation.
- Count delta: fourteen cases in opening owners; one routing-policy case.
- Revisit condition: Phase 13 may consolidate only with complete semantic and
  failure-layer replacement proof.

### TSA-P06-013: Recovery, effect, journal, and compatibility claims are bounded

- State: Deferred with retained owners and explicit phase ownership.
- Severity: High.
- Category: F, with G/H/I/L and Phase 12/13/14 ownership.
- Decision: Keep current evidence; add or gate only at the named owners.
- Tests/cases: Agent lore input, accepted-send recovery, finalization journal,
  generation effects, controlled provider fixtures, prompt walkers, browser
  protocol, and compatibility owners.
- Production owner: required Agent input truncation policy, recovery without a
  wake event, journal row isolation/observability, failed-effect retry,
  provider fidelity, prompt-walker parity, and historical compatibility.
- Protected contract or plausible defect: tiny Agent input limits can skip a
  required lore input; an accepted response loss is recovered after lifecycle
  events but has no same-page timer; one malformed SQLite-JSON-valid journal
  payload can poison a list sweep; failed terminal effects lack a settled retry
  policy. Current browser/provider doubles do not prove real provider networks,
  process crash with a fresh browser context, or multi-tab response loss.
- Evidence: direct control-flow and counterexample review bounds each claim.
  The exact pinned compatibility worktree is absent. No demonstrated current
  false terminal or transcript loss remains after the accepted fixes.
- Companion/overlap analysis: Phase 12 owns journal/runtime observability;
  Phase 13 owns recovery timers, provider/browser composition, effect policy,
  and duplicated-walker parity; Phase 14 owns the final compatibility and
  residual verdict.
- Action and rollback: retain current bounded owners. Do not refresh goldens,
  invent unsupported provider behavior, or add automatic retry before product
  semantics are chosen.
- Validation: all current exact/complete owners pass; this finding deliberately
  limits broader claims.
- Count delta: none.
- Revisit condition: Phase 12 runtime audit, Phase 13 cross-suite remediation,
  and mandatory Phase 14 closeout decision.

## Phase 7 Findings

### TSA-P07-001: Authorization header casing could combine credentials

- State: Done.
- Severity: Critical.
- Category: G/L.
- Decision: Strengthen, then Keep.
- Tests/cases: the 31-case additional-parameter owner and effective request
  companions in OpenAI chat, Responses, legacy instruct, and completion.
- Production owner: canonical provider authorization after compatible-header
  overlays.
- Protected contract or plausible defect: casing variants such as
  `authorization` and `Authorization` could coexist and send attacker-selected
  credentials alongside the resolved server secret.
- Evidence: provider adapters now replace all casing variants with one
  canonical header after overlays; effective-request assertions cover the
  counterexample.
- Companion/overlap analysis: option parsing alone cannot prove the final
  header sent by each adapter.
- Action and rollback: retain canonical replacement at the last adapter
  boundary.
- Validation: 210/210 focused cases and complete Fastify passed.
- Count delta: one case added.
- Revisit condition: apply the same last-writer rule to any new credentialed
  compatible adapter.

### TSA-P07-002: Responses dispatch discarded an exact configured endpoint

- State: Done.
- Severity: High.
- Category: G.
- Decision: Strengthen, then Keep.
- Tests/cases: 19 Responses cases, 100 profile-dispatch cases, and completion
  route companions.
- Production owner: OpenAI Responses endpoint identity from profile resolution
  through dispatch and adapter execution.
- Protected contract or plausible defect: a caller's exact query-bearing
  endpoint could be replaced by an auto-appended `/responses` URL.
- Evidence: `endpointUrl` now survives resolution and dispatch; direct and
  route-backed counterexamples pin the exact URL.
- Companion/overlap analysis: adapter-only URL tests did not prove the dispatch
  handoff.
- Action and rollback: preserve exact endpoint identity; only derive a default
  when no endpoint is configured.
- Validation: 119/119 focused cases and complete Fastify passed.
- Count delta: two cases added.
- Revisit condition: none unless endpoint policy changes explicitly.

### TSA-P07-003: Ooba path normalization could corrupt an API hostname

- State: Done.
- Severity: High.
- Category: G.
- Decision: Strengthen, then Keep.
- Tests/cases: all nine Ooba legacy cases.
- Production owner: local-compatible Ooba URL normalization.
- Protected contract or plausible defect: string/regex removal of `/api`
  could also alter an `api.*` hostname and send to the wrong host.
- Evidence: normalization now edits only `URL.pathname`; an `api.example.com`
  counterexample preserves the hostname.
- Companion/overlap analysis: generic compatible-provider tests do not execute
  this legacy URL rule.
- Action and rollback: retain component-wise URL normalization.
- Validation: 9/9 focused and complete Fastify passed.
- Count delta: one case added.
- Revisit condition: none.

### TSA-P07-004: Gemini 200 SSE errors could terminate as success

- State: Done.
- Severity: High.
- Category: G/F.
- Decision: Strengthen, then Keep.
- Tests/cases: all 56 Gemini cases and shared terminal-frame companions.
- Production owner: Gemini streaming error and terminal disposition.
- Protected contract or plausible defect: an HTTP-200 SSE error frame could be
  ignored and followed by a successful done terminal.
- Evidence: an error frame now emits one terminal error and stops stream
  processing.
- Companion/overlap analysis: HTTP status cases and successful SSE fixtures do
  not prove provider-native error frames.
- Action and rollback: terminate at the first provider error frame.
- Validation: 56/56 focused and complete Fastify passed.
- Count delta: one case added.
- Revisit condition: extend the error parser only from recorded provider
  contract evidence.

### TSA-P07-005: Translation profile options and cache identity diverged

- State: Done.
- Severity: High.
- Category: G.
- Decision: Strengthen, then Keep.
- Tests/cases: 28 raw server-translation cases and 23 Svelte+Node translation
  cache cases.
- Production owner: LLM translation profile/runtime option resolution and
  cache identity.
- Protected contract or plausible defect: profile sampler options could be
  ignored, and cache hits could return output generated under different
  runtime options.
- Evidence: profile-bound generation fields now flow into raw translation;
  runtime options participate in the client cache signature while translation
  still forces its bounded output/transport fields.
- Companion/overlap analysis: preset eligibility and ordinary chat dispatch do
  not prove translation-specific override order or cache invalidation.
- Action and rollback: retain resolved sampler propagation and complete cache
  identity.
- Validation: 28/28 server and 23/23 client focused cases passed.
- Count delta: two cases added.
- Revisit condition: add every newly supported output-affecting option to the
  cache identity.

### TSA-P07-006: Request-history metadata and errors could persist secrets

- State: Done.
- Severity: Critical.
- Category: G/L.
- Decision: Strengthen, then Keep.
- Tests/cases: nine request-history unit cases, two route cases, and completion
  dispatch companions.
- Production owner: request-history persistence, route projection, and
  provider-option credential handling.
- Protected contract or plausible defect: nested metadata, response, or error
  text could persist provider credentials in SQLite and return them through
  history routes.
- Evidence: sensitive keys and known credential values are recursively
  sanitized before persistence across prompt/context/toggles/metadata,
  response, error, and API metadata.
- Companion/overlap analysis: trace redaction and masked configuration
  projection do not own the independent history store.
- Action and rollback: carry the operation redaction set into the history
  writer and sanitize before SQLite.
- Validation: 104/104 focused cases, server typecheck, and complete Fastify
  passed.
- Count delta: two cases added.
- Revisit condition: new request-history fields must enter the recursive
  sanitizer before exposure.

### TSA-P07-007: Stored NovelAI credentials were not bound to NovelAI

- State: Done.
- Severity: Critical.
- Category: G/L.
- Decision: Strengthen, then Keep.
- Tests/cases: all 20 image-generation cases.
- Production owner: NovelAI image endpoint and credential resolution.
- Protected contract or plausible defect: a persisted custom image endpoint
  could receive the stored NovelAI credential.
- Evidence: stored credentials are accepted only for the exact official HTTPS
  origin; custom endpoints require an explicit draft credential.
- Companion/overlap analysis: closed request parsing prevented caller-supplied
  URLs but did not constrain a persisted endpoint paired with a stored secret.
- Action and rollback: retain exact-origin binding at server execution.
- Validation: 20/20 focused cases and complete Fastify passed; the fetch-spy
  typing correction also passed server typecheck.
- Count delta: two cases added.
- Revisit condition: any additional official origin requires an explicit
  allowlist and regression fixture.

### TSA-P07-008: VOICEVOX playback interpolated raw query values

- State: Done.
- Severity: High.
- Category: G/L.
- Decision: Strengthen, then Keep.
- Tests/cases: all 23 TTS cases.
- Production owner: VOICEVOX audio-query and synthesis request construction.
- Protected contract or plausible defect: translated text or speaker values
  containing `&`, `=`, or `#` could inject or truncate query parameters.
- Evidence: both URLs use `URL`/`searchParams`; the counterexample preserves a
  configured base subpath and proves no injected parameter exists.
- Companion/overlap analysis: speaker-catalog caching never executes playback
  request construction.
- Action and rollback: retain structured URL construction.
- Validation: 23/23 focused and complete frontend passed.
- Count delta: one case added.
- Revisit condition: none.

### TSA-P07-009: Horde ignored non-OK polling responses

- State: Done.
- Severity: High.
- Category: G.
- Decision: Strengthen, then Keep.
- Tests/cases: all 19 Horde cases.
- Production owner: asynchronous Horde polling and remote-job cleanup.
- Protected contract or plausible defect: failed polls could be parsed or
  retried as if successful, hiding an HTTP failure and leaving the job alive.
- Evidence: non-OK polls now produce a bounded HTTP failure and issue the job
  DELETE cleanup.
- Companion/overlap analysis: submission and successful polling fixtures did
  not prove failure cleanup.
- Action and rollback: fail and cancel on the first non-OK poll.
- Validation: 19/19 focused and complete Fastify passed.
- Count delta: one case added.
- Revisit condition: retry only after an explicit provider/status policy.

### TSA-P07-010: SigV4 confidence lacked an independent signature vector

- State: Done.
- Severity: High.
- Category: G/L.
- Decision: Strengthen, then Keep.
- Tests/cases: nine SigV4 cases and 22 Bedrock companion cases.
- Production owner: AWS canonical request and signature generation.
- Protected contract or plausible defect: production and test could agree on
  the same incorrect canonicalization, particularly internal header spaces.
- Evidence: a hard-coded signature was independently cross-checked with the
  Smithy implementation; a whitespace counterexample fixes canonical header
  normalization.
- Companion/overlap analysis: round-trip or self-derived assertions are not an
  independent signing oracle.
- Action and rollback: retain the published-vector-style exact signature and
  canonical whitespace rule.
- Validation: 31/31 focused and complete Fastify cases passed.
- Count delta: one case added.
- Revisit condition: add a new independent vector for a materially different
  AWS signing mode.

### TSA-P07-011: Provider-adjacent names hid D/E/F owners

- State: Done.
- Severity: Medium.
- Category: G to D/E/F.
- Decision: Reclassify.
- Tests/cases: eight complete owners / 69 cases listed by
  `phase7-reclassified` state in `inventory.json`.
- Production owner: provider-list and completion-sound UI, parameter and
  character-emotion authoring, and generation dispatch/emotion/client-context
  orchestration.
- Protected contract or plausible defect: provider vocabulary could obscure
  the dominant visible, authoring, or generation failure mode.
- Evidence: three exact-path boundary rules and an eight-owner counterexample
  matrix assign every owner to its product contract.
- Companion/overlap analysis: lane and specialized ownership remain unchanged.
- Action and rollback: retain all owners under D/E/F.
- Validation: routing policy passed 9/9 and generated inventory has the exact
  intended assignments.
- Count delta: one routing-policy case; no owner removed.
- Revisit condition: only if a complete owner's dominant contract changes.

### TSA-P07-012: Provider and media evidence layers remain distinct

- State: Done.
- Severity: Informational.
- Category: G with F/L and browser seams.
- Decision: Keep.
- Tests/cases: the complete 103-file, 1,408-case reviewed opening set after
  remediation.
- Production owner: provider/model inputs through credential resolution,
  request/stream execution, translation/media consumption, and projection.
- Protected contract or plausible defect: merging by provider name would erase
  independent conversion, endpoint, dispatch, stream, credential, history,
  cache, and playback failures.
- Evidence: every owner has a complete contract in `inventory.json`; no owner
  met the mandatory replacement/removal proof.
- Companion/overlap analysis: frontend Node/Svelte/DOM and Fastify layers fail
  at different boundaries. No G browser owner exists.
- Action and rollback: retain the reviewed owners and corrected-category
  companions; merge only with full failure-layer replacement proof.
- Validation: 1,408/1,408 exact opening-owner cases and complete lanes passed.
- Count delta: fourteen regression cases and one routing-policy case.
- Revisit condition: Phase 13 consolidation may act only with the plan's full
  proof package.

### TSA-P07-013: Provider, credential, media, and compatibility claims are bounded

- State: Deferred with retained owners and explicit phase ownership.
- Severity: High.
- Category: G, with L and Phase 12/13/14 ownership.
- Decision: Keep current evidence; add or gate only at the named owners.
- Tests/cases: provider adapters/operations, credential projections/history,
  controlled upstream doubles, TTS/media owners, smoke suite, and compatibility
  harness.
- Production owner: live/recorded provider parity, full credential journey,
  real browser media semantics, Ollama structured/multimodal support, and
  historical transports.
- Protected contract or plausible defect: controlled fetch fixtures cannot
  prove third-party protocol drift; current smoke does not perform a complete
  stored-secret provider journey or exercise actual media devices. Ollama
  structured/multimodal behavior lacks a recorded product-support decision.
- Evidence: direct boundary review found no G browser owner and no recorded or
  live canary. The exact pinned compatibility worktree is absent.
- Companion/overlap analysis: Phase 12 owns credential/runtime observability;
  Phase 13 owns bounded provider/browser and media composition; Phase 14 owns
  the final residual, product-policy, and compatibility verdict.
- Action and rollback: retain current bounded evidence. Do not call live paid
  providers, infer device fidelity from mocks, substitute a baseline, or
  refresh goldens.
- Validation: current exact, complete, smoke, and static lanes pass; this
  finding deliberately limits broader claims.
- Count delta: none.
- Revisit condition: Phase 12 runtime audit, Phase 13 remediation, and
  mandatory Phase 14 closeout decision.

## Phase 8 Findings

### TSA-P08-001: Memory snapshots could resurrect jobs or reject a new stream

- State: Done.
- Severity: High.
- Category: H/B.
- Decision: Strengthen, then Keep.
- Tests/cases: eight projection cases and 19 refresh/event/modal companions.
- Production owner: browser memory job stream/version projection.
- Protected contract or plausible defect: a lower-version snapshot from the
  same stream could resurrect removed work; a new stream could inherit the old
  stream's higher version and reject its valid terminal event.
- Evidence: same-stream lower versions are rejected, while replacement across
  stream identity adopts the new snapshot version before later events.
- Companion/overlap analysis: refresh request fences did not cover direct
  snapshot application or server-stream replacement.
- Action and rollback: retain per-stream monotonicity and reset version on a
  stream handoff.
- Validation: 27/27 focused projection/refresh/event/modal cases and complete
  frontend passed.
- Count delta: two cases added.
- Revisit condition: none unless multiple simultaneous server streams become
  supported.

### TSA-P08-002: Transcript edits left stale unsummarized durable memory

- State: Done.
- Severity: Critical.
- Category: H/C.
- Decision: Strengthen, then Keep.
- Tests/cases: the message-store and command owners, 251 focused cases.
- Production owner: message mutation transaction and transcript-derived memory
  invalidation.
- Protected contract or plausible defect: editing or replacing a persisted
  message could leave an unsummarized chunk and durable job that later appears
  current and summarizes obsolete content.
- Evidence: the message-store boundary compares the effective prompt-memory
  source and deletes only unsummarized chunks and jobs naming them in the same
  transaction. Pure appends, summarized memory, and other chats remain intact.
- Companion/overlap analysis: planners prove creation/idempotency but did not
  own edits through every message mutation path.
- Action and rollback: invalidate derived, unfinished memory at the shared
  mutation boundary.
- Validation: 251/251 focused cases, server typecheck, and complete Fastify
  passed.
- Count delta: one case added.
- Revisit condition: summarized-memory behavior remains the explicit policy
  residual in `TSA-P08-012`.

### TSA-P08-003: Memory job errors leaked common credential forms

- State: Done.
- Severity: Critical.
- Category: H/L.
- Decision: Strengthen, then Keep.
- Tests/cases: all 13 memory-event presentation cases plus job-route
  companions.
- Production owner: terminal job error event and API presentation.
- Protected contract or plausible defect: quoted JSON credentials, URL
  userinfo, generic query keys, access tokens, bearer/basic values, or
  provider-shaped secrets could survive the narrow sanitizer.
- Evidence: the bounded sanitizer now covers structured keys, auth schemes,
  URL credentials, query values, and common provider/AWS/Google/GitHub token
  forms.
- Companion/overlap analysis: provider request-history and trace redaction do
  not own independently persisted memory job errors.
- Action and rollback: sanitize at terminal event/route presentation while
  keeping durable diagnostic length bounded.
- Validation: 13/13 focused cases and complete Fastify passed.
- Count delta: seven parameterized cases added.
- Revisit condition: add newly supported provider token forms to the shared
  counterexample matrix.

### TSA-P08-004: Finite numbers could overflow when stored as Float32

- State: Done.
- Severity: High.
- Category: H/G.
- Decision: Strengthen, then Keep.
- Tests/cases: all 14 memory embedding-adapter cases.
- Production owner: provider embedding response normalization.
- Protected contract or plausible defect: a finite JavaScript number such as
  `1e39` becomes `Infinity` in Float32 and could corrupt ranking/storage after
  passing the original finite check.
- Evidence: every value must remain finite under `Math.fround` before
  conversion.
- Companion/overlap analysis: repository blob validation occurs after the
  adapter and cannot make corrupt provider output valid.
- Action and rollback: reject Float32 overflow as an invalid provider response.
- Validation: 14/14 focused cases and complete Fastify passed.
- Count delta: one case added.
- Revisit condition: none while embeddings remain Float32.

### TSA-P08-005: Legacy memory salvage silently omitted malformed summaries

- State: Done.
- Severity: High.
- Category: H/K.
- Decision: Strengthen, then Keep.
- Tests/cases: all seven legacy-memory import cases and 65 save/import route
  companions.
- Production owner: legacy Hypa V3 backfill and import reporting.
- Protected contract or plausible defect: malformed summary rows could vanish
  while valid neighbors import, leaving users with unexplained partial memory
  loss.
- Evidence: valid rows are salvaged; every malformed row returns an exact
  structural path/reason. Import responses expose the report conditionally and
  startup backfill logs it.
- Companion/overlap analysis: generic skipped-block reporting did not include
  memory summaries.
- Action and rollback: retain salvage with explicit diagnostics; do not reject
  an otherwise readable save.
- Validation: focused memory cases, save/import route owners, server typecheck,
  and complete Fastify passed.
- Count delta: two cases added.
- Revisit condition: expand reasons only when another malformed legacy shape
  is deliberately salvageable.

### TSA-P08-006: Embedding cache keys had delimiter collisions

- State: Done.
- Severity: Medium.
- Category: H/G.
- Decision: Strengthen, then Keep.
- Tests/cases: all three embedding cache-identity cases.
- Production owner: client embedding result cache identity.
- Protected contract or plausible defect: content containing the hand-built
  delimiter could collide with custom model/endpoint identity and reuse the
  wrong vector.
- Evidence: keys are versioned JSON tuples over input, model, custom model,
  normalized endpoint, and context suffix.
- Companion/overlap analysis: provider operation keys and stored embeddings do
  not own this client cache.
- Action and rollback: keep the unambiguous versioned tuple.
- Validation: 3/3 focused and complete frontend cases passed.
- Count delta: one case added.
- Revisit condition: bump the version when key semantics change.

### TSA-P08-007: One throwing memory-event listener blocked later consumers

- State: Done.
- Severity: Medium.
- Category: H/B.
- Decision: Strengthen, then Keep.
- Tests/cases: both browser memory-event fanout cases.
- Production owner: client memory job event subscriber fanout.
- Protected contract or plausible defect: a broken projection listener could
  throw out of publication and starve the mounted UI or another controller.
- Evidence: listeners are isolated independently and publication remains
  non-throwing.
- Companion/overlap analysis: server event fanout already had isolation; it
  could not protect client-local subscribers.
- Action and rollback: retain best-effort per-listener isolation.
- Validation: 2/2 focused and complete frontend cases passed.
- Count delta: one case added.
- Revisit condition: none.

### TSA-P08-008: Delayed cancellation could replace a recreated job instance

- State: Done.
- Severity: Medium.
- Category: H/D.
- Decision: Strengthen, then Keep.
- Tests/cases: all five mounted server-memory-job component cases.
- Production owner: Hypa modal cancellation and concrete job-instance owner.
- Protected contract or plausible defect: cancel instance A, leave/return or
  recreate the logical ID as instance B, then accept A's delayed terminal
  response into B's current projection.
- Evidence: cancellation captures chat, owner epoch, and instance; only a
  still-displayed matching instance may accept the result. Busy state is also
  instance-keyed.
- Companion/overlap analysis: refresh/projection instance fences cannot know
  which mounted owner initiated the request.
- Action and rollback: fence the async response at the component owner.
- Validation: 5/5 focused, typecheck, and complete frontend passed.
- Count delta: one case added.
- Revisit condition: none unless cancel becomes a server-pushed-only action.

### TSA-P08-009: Terminal memory-job listings were unbounded

- State: Done.
- Severity: Medium.
- Category: H/L.
- Decision: Strengthen, then Keep.
- Tests/cases: ten memory-job route cases and 21 repository companions.
- Production owner: authenticated memory-job history query and response.
- Protected contract or plausible defect: explicit terminal-status filters and
  default history could materialize, hash, and serialize all retained terminal
  rows.
- Evidence: terminal queries select the newest 50 at SQLite and presentation;
  active jobs remain complete and existing ETag/version behavior is preserved.
- Companion/overlap analysis: startup retention bounds age, not the number of
  rows created inside that window.
- Action and rollback: retain the documented bounded history; add a cursor only
  with an explicit API product requirement.
- Validation: 31/31 focused route/repository cases and server typecheck passed.
- Count delta: one route case added.
- Revisit condition: add pagination if callers need older terminal history.

### TSA-P08-010: Memory-shaped names hid five product-risk categories

- State: Done.
- Severity: Medium.
- Category: H to B/D/F/G/L.
- Decision: Reclassify.
- Tests/cases: 17 complete owners / 199 cases listed by
  `phase8-reclassified` state in `inventory.json`.
- Production owner: prompt generation, provider adapters/models, shared stream
  runtime, visible worker feedback, and browser summary projection.
- Protected contract or plausible defect: reviewing these only as memory
  lifecycle owners hides their dominant generation, provider, platform,
  visible UI, or browser-state companions.
- Evidence: exact-path rules and a 17-owner counterexample matrix route every
  owner.
- Companion/overlap analysis: lane and specialized ownership do not change.
- Action and rollback: retain every owner under B/D/F/G/L.
- Validation: routing policy passed 10/10 and generated inventory has exact
  assignments.
- Count delta: one policy case; no owner removed.
- Revisit condition: only if a complete owner's dominant contract changes.

### TSA-P08-011: Memory lifecycle evidence layers remain distinct

- State: Done.
- Severity: Informational.
- Category: H with B/C/D/F/G/L seams.
- Decision: Keep.
- Tests/cases: the complete 43-file, 470-case reviewed opening set after
  remediation.
- Production owner: planning through SQLite state, provider execution,
  handler/worker transitions, routes/events, browser projection, and mounted UI.
- Protected contract or plausible defect: merging by memory terminology would
  erase distinct semantic, transaction, scheduler, API, race, and visible
  owner failures.
- Evidence: every owner has a complete contract in `inventory.json`; no owner
  met replacement/removal proof.
- Companion/overlap analysis: Node/DOM/Fastify layers and outgoing category
  companions fail at different boundaries. No H browser owner exists.
- Action and rollback: retain reviewed owners; consolidate only with full
  semantic and failure-layer replacement evidence.
- Validation: 470/470 exact opening-owner cases and complete lanes passed.
- Count delta: sixteen opening-owner cases and one policy case.
- Revisit condition: Phase 13 may consolidate only under the plan's proof
  package.

### TSA-P08-012: Browser, provider, summarized-memory, and restart claims are bounded

- State: Deferred with retained owners and explicit phase ownership.
- Severity: High.
- Category: H, with G/L and Phase 12/13/14 ownership.
- Decision: Keep current evidence; add or gate only at named owners.
- Tests/cases: memory worker/handlers, provider doubles, summarized repository,
  browser projection/modal, smoke suite, and compatibility harness.
- Production owner: real job progress/reconnect/reload, provider parity,
  summarized-memory policy after transcript edits, provider in-flight restart,
  and historical memory formats.
- Protected contract or plausible defect: smoke disables the memory worker and
  no browser H owner connects planning, jobs, editing, cancellation, reload,
  and prompt use. Controlled upstreams cannot prove provider drift. The product
  has not chosen whether a transcript edit invalidates user-curated summaries.
- Evidence: exact boundary review found strong isolated layers but no live
  journey. The exact pinned compatibility worktree is absent.
- Companion/overlap analysis: Phase 12 owns worker/query observability; Phase
  13 owns bounded browser composition and summarized-memory policy; Phase 14
  owns final residual and compatibility decisions.
- Action and rollback: retain bounded evidence. Do not delete curated summaries,
  enable paid provider calls, substitute a baseline, or refresh goldens without
  explicit product/evidence ownership.
- Validation: exact, complete, smoke, static, and inventory lanes pass; this
  finding deliberately limits broader claims.
- Count delta: none.
- Revisit condition: Phase 12 runtime audit, Phase 13 remediation, and mandatory
  Phase 14 closeout decision.

## Phase 9 Findings

### TSA-P09-001: Nested server CBS expansion reset the recursion budget

- State: Done.
- Severity: Critical.
- Category: I/F.
- Decision: Strengthen, then Keep.
- Tests/cases: all 26 server prompt-variable cases plus the CBS parser owners.
- Production owner: server CBS adapter recursion and prompt-field expansion.
- Protected contract or plausible defect: a self-referential description or
  personality expansion could receive a fresh call stack on every nested CBS
  pass and recurse without reaching the supported sentinel.
- Evidence: matcher arguments now carry `callStack` through the adapter; both
  self-referential fields stop at `ERROR: Call stack limit reached`.
- Companion/overlap analysis: browser CBS recursion tests could not prove that
  the Fastify adapter preserved the same budget.
- Action and rollback: retain call-stack propagation at the adapter boundary.
- Validation: 26/26 focused prompt-variable cases, the 43-owner exact set, and
  complete Fastify passed.
- Count delta: two parameterized cases added.
- Revisit condition: none unless a new CBS adapter is introduced.

### TSA-P09-002: Regex execution and output growth were not bounded end to end

- State: Done.
- Severity: Critical.
- Category: I.
- Decision: Strengthen, then Keep.
- Tests/cases: 15 server bounded-regex cases, 15 client edit/display cases, and
  nine client compile/cache cases.
- Production owner: client and Fastify user-authored regex compilation,
  execution, replacement, movement, and output construction.
- Protected contract or plausible defect: prefix-overlapping quantified
  alternatives could evade the complexity screen; browser scripts ran raw
  regex on the main thread; replacement tokens and repeated matches could
  construct oversized output before a result check.
- Evidence: the server screen now rejects overlapping alternatives and all
  server operations cap output. Client script operations execute in a real
  Worker whose deadline terminates and recreates it; the worker incrementally
  builds native-compatible output under caps. Main-thread trigger compilation
  uses the same nested/overlapping complexity screen and fails closed.
- Companion/overlap analysis: the server worker could not preempt browser
  execution, while a timer around main-thread regex would not have preempted
  anything. The trigger gate is deliberately conservative because those
  legacy paths are still synchronous.
- Action and rollback: retain the preemptive Worker, bounded protocol, and
  cache-miss complexity gate. Do not replace them with `Promise.race`.
- Validation: 75 focused script/trigger/editor cases, native-token parity
  vectors, 6/6 performance gates, typechecks, production build, exact owners,
  and complete frontend/Fastify lanes passed.
- Count delta: seven server and five client cases added.
- Revisit condition: Phase 13 may move synchronous trigger regex into the
  Worker only with full directive/effect parity and browser evidence.

### TSA-P09-003: Failed client interpreters remained reusable and Python had no deadline

- State: Done.
- Severity: High.
- Category: I.
- Decision: Strengthen, then Keep.
- Tests/cases: all 28 client scripting cases.
- Production owner: cached client Lua engines and Python worker request
  lifecycle.
- Protected contract or plausible defect: a Lua engine that failed creation,
  load, or execution could poison later identical runs; Python initialization
  or a call could remain pending indefinitely and retain its access key.
- Evidence: failed Lua states are closed and evicted. Python initialization and
  execution use separate normalized deadlines; timeout terminates the worker,
  clears pending access, and permits a clean identical retry.
- Companion/overlap analysis: server Lua budgets and a cached-worker
  termination event did not own browser-side initialization or request stalls.
- Action and rollback: retain failure eviction and separate cold-init/call
  deadlines.
- Validation: 28/28 focused scripting cases, client typecheck, and complete
  frontend passed.
- Count delta: four cases added.
- Revisit condition: extend the matrix when another client interpreter is
  cached.

### TSA-P09-004: Server Lua response limits counted code units instead of bytes

- State: Done.
- Severity: High.
- Category: I/L.
- Decision: Strengthen, then Keep.
- Tests/cases: all 52 server Lua runtime cases.
- Production owner: Lua `request()` egress response limit.
- Protected contract or plausible defect: a multibyte response could remain
  below the JavaScript string-length cap while exceeding the intended byte
  budget.
- Evidence: streamed and injected fetch paths count UTF-8 bytes; a two-byte
  character counterexample is rejected.
- Companion/overlap analysis: request rate, SSRF, abort, and aggregate runtime
  limits constrain different resources.
- Action and rollback: retain byte accounting at both response seams.
- Validation: 52/52 focused cases, server typecheck, and complete Fastify
  passed.
- Count delta: one case added.
- Revisit condition: none while the API returns decoded text.

### TSA-P09-005: Trigger V2 import trusted malformed nested rows

- State: Done.
- Severity: High.
- Category: I/K.
- Decision: Strengthen, then Keep.
- Tests/cases: all 17 Trigger V2 import cases.
- Production owner: imported trigger schema boundary.
- Protected contract or plausible defect: valid outer arrays could contain
  null, array, missing-type, wrong-type, or invalid-indent conditions/effects
  that fail later inside the editor or executor.
- Evidence: nested rows must be objects with string types and numeric indents
  when present; unknown future types and fields remain preserved.
- Companion/overlap analysis: editor controls and runtime trigger cases assume
  a structurally usable imported definition.
- Action and rollback: validate shape without turning the importer into a
  closed enum that rejects forward-compatible definitions.
- Validation: 17/17 focused import cases, client typecheck, and complete
  frontend passed.
- Count delta: ten cases added, including nine parameterized rows.
- Revisit condition: add structural requirements only when the runtime requires
  them for every future type.

### TSA-P09-006: Script-result cache identities had delimiter collisions

- State: Done.
- Severity: Medium.
- Category: I.
- Decision: Strengthen, then Keep.
- Tests/cases: all 15 edit/display script cases.
- Production owner: processed regex-script result cache.
- Protected contract or plausible defect: hand-concatenated definition fields
  containing the delimiter could alias another script tuple and reuse the wrong
  visible result.
- Evidence: cache identity is a versioned JSON tuple over input, mode, scope,
  chat, and normalized active definitions.
- Companion/overlap analysis: compiled-regex and best-match caches have
  different keys and values.
- Action and rollback: retain the unambiguous tuple and bump its version when
  semantics change.
- Validation: 15/15 focused cases and complete frontend passed.
- Count delta: one cache-identity case; the same owner later gained three
  client-regex boundary cases under `TSA-P09-002`.
- Revisit condition: none.

### TSA-P09-007: Scripting-shaped names hid four product-risk categories

- State: Done.
- Severity: Medium.
- Category: I to D/F/G/L.
- Decision: Reclassify.
- Tests/cases: four complete owners / 16 cases listed by
  `phase9-reclassified` state in `inventory.json`.
- Production owner: visible partial-edit projection, generation output-trigger
  sequencing, provider input-hook activity, and hub HTML transport policy.
- Protected contract or plausible defect: parser/hook/HTML vocabulary could
  hide the dominant visible, generation, provider, or platform failure mode.
- Evidence: exact-path routing rules and executable counterexamples assign all
  four owners to D/F/G/L while retaining scripting seams.
- Companion/overlap analysis: runtime lane and specialized ownership do not
  change.
- Action and rollback: retain all owners unchanged under their corrected
  primary categories.
- Validation: routing-policy tests and the regenerated 700-owner inventory
  passed.
- Count delta: one policy case; no owner removed.
- Revisit condition: only if a complete owner's dominant contract changes.

### TSA-P09-008: Display protocol and cache owners are intentionally separate

- State: Done.
- Severity: Informational.
- Category: I with B/D seams.
- Decision: Keep.
- Tests/cases: server/client display-source, protocol, reload, and parser-cache
  owners in the reviewed set.
- Production owner: display-source request protocol, source/dependency cache
  identity, ephemeral script state, and visible transformed output.
- Protected contract or plausible defect: merging these owners would hide a
  stale dependency fingerprint, protocol mismatch, reload failure, or
  authoritative/ephemeral state leak behind the same final string.
- Evidence: review traced source identity and dependency fingerprints through
  server preparation, client protocol, reload, and render projection. Each
  layer has a distinct failure oracle.
- Companion/overlap analysis: exact output alone cannot prove cache ownership;
  cache identity alone cannot prove protocol or visible projection.
- Action and rollback: retain the separate owners; consolidate only with the
  mandatory replacement proof.
- Validation: exact opening set and both complete lanes passed.
- Count delta: none.
- Revisit condition: Phase 13 may consolidate only if one owner proves every
  named failure mode.

### TSA-P09-009: The scripting guide contained stale diagnostic claims

- State: Done.
- Severity: Low.
- Category: I/A.
- Decision: Correct documentation.
- Tests/cases: CBS escape/loop owners and the Python worker group.
- Production owner: authoritative testing guidance.
- Protected contract or plausible defect: the guide claimed the colon case
  repeated semicolon, omitted-`as` duplicated one assertion, two loop cases
  shared a title, and Python had only four protocol cases after those facts had
  changed.
- Evidence: source and fresh collection show two colon aliases, literal and
  variable omitted-`as` inputs, distinct 2-D titles, and six Python cases with
  deadline/recovery coverage.
- Companion/overlap analysis: stale guidance can misdirect later consolidation
  even while executable tests remain correct.
- Action and rollback: update `docs/tests/scripting-parsing-and-automation.md`
  to match the reviewed suite.
- Validation: documentation formatting and fresh list evidence passed.
- Count delta: none.
- Revisit condition: update the guide with future material contract changes.

### TSA-P09-010: Interpreter and automation evidence layers remain distinct

- State: Done.
- Severity: Informational.
- Category: I with D/F/G/K/L seams.
- Decision: Keep.
- Tests/cases: the complete 43-file, 574-case reviewed opening set after
  remediation.
- Production owner: CBS/parser semantics through definitions, caches, client
  and server runtimes, triggers, display protocol, editors, and projection.
- Protected contract or plausible defect: merging by scripting vocabulary
  would erase distinct schema, parser, timeout, cache, durable-effect, editor,
  protocol, and visible-output failures.
- Evidence: every opening owner has a complete disposition in `inventory.json`;
  no owner met the mandatory merge/removal proof.
- Companion/overlap analysis: frontend Node/Svelte/DOM and Fastify layers fail
  at different boundaries. No built-browser category-I owner exists.
- Action and rollback: retain reviewed owners and corrected-category
  companions; merge only with complete semantic and failure-layer proof.
- Validation: 574/574 exact opening-owner cases and complete lanes passed.
- Count delta: 30 opening-owner regressions and one routing-policy case.
- Revisit condition: Phase 13 consolidation may act only with the full proof
  package.

### TSA-P09-011: Runtime parity and browser composition claims are bounded

- State: Deferred with retained owners and explicit phase ownership.
- Severity: High.
- Category: I, with D/F/L and Phase 12/13/14 ownership.
- Decision: Keep current bounded evidence; add only at the named owners.
- Tests/cases: CBS adapters, client/server trigger and Lua owners, mocked Python
  and regex worker protocols, definition editors, smoke, and compatibility.
- Production owner: complete client/server CBS and trigger parity, real
  Pyodide/browser-worker lifecycle, queued Lua cancellation, saved-definition
  persistence/reload/runtime composition, and historical behavior.
- Protected contract or plausible defect: current matrices do not cover every
  host callback or Trigger V2 data arm. No category-I browser owner runs a saved
  regex/trigger/Lua definition through edit, reload, execution, and visible
  output. Pyodide tests use a protocol double, and a canceled request waiting
  for the serialized server Lua engine has no prompt queue-removal proof.
- Evidence: all active regex/script operations are now preempted, bounded, or
  fail closed; active Lua/Python execution is deadline-bound. The remaining
  gaps concern parity, queued cancellation, and real composition rather than an
  accepted unbounded production path. The pinned historical worktree is absent.
- Companion/overlap analysis: Phase 12 owns runtime queue/timeout
  observability; Phase 13 owns parity matrices and a bounded browser journey;
  Phase 14 owns the final residual and historical-compatibility verdict.
- Action and rollback: retain current evidence. Do not infer real-worker or
  browser composition from doubles, substitute a baseline, or refresh goldens.
- Validation: exact, complete, performance, build, smoke, type, inventory, and
  current-only compatibility lanes pass; this finding limits broader claims.
- Count delta: none.
- Revisit condition: Phase 12 runtime audit, Phase 13 remediation, and mandatory
  Phase 14 closeout decision.

## Phase 10 Findings

### TSA-P10-001: Delayed plugin keyboard callbacks survived listener teardown

- State: Done.
- Severity: High.
- Category: J.
- Decision: Strengthen, then Keep.
- Tests/cases: all 67 Plugin V3 lifecycle and API cases.
- Production owner: `SafeElement` keyboard listeners and Plugin V3 lifecycle
  cleanup.
- Protected contract or plausible defect: keyboard events are deliberately
  delayed before entering plugin code. Removing the listener or unloading the
  plugin removed the document listener but did not cancel already queued
  callbacks, so code could run after its authority and lifecycle ended.
- Evidence: each delayed listener now owns its pending timeout handles;
  explicit removal and lifecycle cleanup cancel and clear them.
- Companion/overlap analysis: registration cleanup could prove no future DOM
  event was accepted, but it could not observe a callback already transferred
  to the timer queue.
- Action and rollback: retain per-listener timeout ownership and cancellation
  through both cleanup paths.
- Validation: 67/67 focused cases, exact Phase 10 frontend, client typecheck,
  and complete frontend passed.
- Count delta: two lifecycle regressions added.
- Revisit condition: apply the same ownership rule to any future delayed plugin
  callback source.

### TSA-P10-002: MCP bodies, frames, and list pagination could remain unresolved

- State: Done.
- Severity: High.
- Category: J.
- Decision: Strengthen, then Keep.
- Tests/cases: all 41 MCP transport cases plus OAuth/registry companions.
- Production owner: MCP HTTP JSON reads, SSE framing and errors, prompt/tool
  pagination, request deadlines, and cleanup.
- Protected contract or plausible defect: the request deadline ended after
  response headers, leaving a stalled JSON body unbounded. Malformed SSE JSON
  was swallowed until timeout; CRLF and no-space `data:` fields were not parsed;
  repeated or endless cursors could issue unbounded requests and retain items.
- Evidence: JSON consumption is deadline-raced and aborts its transport. The
  SSE scanner handles CRLF/LF/CR across chunk boundaries, optional field space,
  and multiline data; malformed JSON becomes a request-visible `-32700`/502
  result and cancels the stream. Prompt/tool lists reject invalid or repeated
  cursors, more than 100 pages, or more than 10,000 aggregate items without
  caching partial data.
- Companion/overlap analysis: `fetchNative` timeouts could not bound work after
  headers; listener timers could not explain malformed frames; UI MCP tests
  could not prove transport pagination termination.
- Action and rollback: retain body deadlines, deterministic frame errors, and
  exported page/item caps. Do not restore silent parse failure.
- Validation: 41/41 focused transport cases, exact Phase 10 owners, client
  typecheck, and complete frontend passed.
- Count delta: seven transport regressions added.
- Revisit condition: add runtime schema validation when MCP tool/result schema
  compatibility policy is selected.

### TSA-P10-003: Permission-delayed RisuAccess writes could target replacement owners

- State: Done.
- Severity: High.
- Category: J/C.
- Decision: Strengthen, then Keep.
- Tests/cases: 34 character/module optimistic-projection cases plus eight
  module-schema/read cases.
- Production owner: character and module lorebook, regex, and Lua mutations
  after access confirmation.
- Protected contract or plausible defect: these mutation families captured a
  live row, awaited permission, and then wrote through that reference without
  proving it was still the database's current row. A same-ID replacement could
  receive stale projection or command work.
- Evidence: every affected set/delete family re-resolves the live ID and
  requires exact row identity after confirmation. Same-ID replacements return
  a retry error, remain byte-for-byte unchanged, and dispatch no command.
- Companion/overlap analysis: `setCharacterInfo` already had its own stable
  identity check; ordinary optimistic rollback did not cover the permission
  window in the six collection/script families.
- Action and rollback: retain the shared post-confirmation identity fences.
- Validation: 34/34 focused mutation cases, exact Phase 10 owners, client
  typecheck, and complete frontend passed.
- Count delta: six parameterized family regressions added.
- Revisit condition: require the same fence for each new permission-delayed
  resource mutation.

### TSA-P10-004: Module activation memo ignored in-place identity edits

- State: Done.
- Severity: High.
- Category: J.
- Decision: Strengthen, then Keep.
- Tests/cases: all 40 client module aggregation cases and the server module/memo
  companions.
- Production owner: active-module selection and memo invalidation.
- Protected contract or plausible defect: the memo compared activation keys
  and source-array identity, but an in-place row edit could change `id` or
  `namespace` and return the previously active set.
- Evidence: cache hits now require index-stable row identity plus snapshotted
  `id` and `namespace`; cache hits remain allocation-free and O(n). A regression
  activates/deactivates the same row through namespace and ID edits.
- Companion/overlap analysis: row replacement and activation-key tests did not
  exercise mutation inside the same array and object.
- Action and rollback: retain the identity-field snapshot or replace it only
  with an equally sensitive versioned source owner.
- Validation: 40/40 focused cases, exact Phase 10 owners, client typecheck, and
  complete frontend/Fastify lanes passed.
- Count delta: one regression added.
- Revisit condition: extend the snapshot if another row field controls module
  activation.

### TSA-P10-005: Image translation work outlived its component

- State: Done.
- Severity: High.
- Category: J/G.
- Decision: Strengthen, then Keep.
- Tests/cases: all 18 mounted image-translation cases.
- Production owner: selected-image decoding, model request, canvas projection,
  alerts, and component teardown.
- Protected contract or plausible defect: input/mode epochs rejected several
  stale results, but unmount did not abort the active request or fence late
  render, loading, and error feedback.
- Evidence: each translation owns an `AbortController`; teardown aborts it,
  invalidates pending selection, and marks the component destroyed. Late
  completions cannot mutate output, render, loading, or alert state.
- Companion/overlap analysis: image-generation and subtitle components had
  separate abort tests; their cleanup could not protect this component.
- Action and rollback: retain abort plus destroyed-state fencing around every
  asynchronous completion path.
- Validation: 18/18 focused mounted cases, exact Phase 10 frontend, client
  typecheck, and complete frontend passed.
- Count delta: one unmount regression added.
- Revisit condition: add real canvas/decoder proof under the bounded Phase 13
  browser composition owner.

### TSA-P10-006: The internal filesystem catalog advertised an impossible watch tool

- State: Done.
- Severity: Medium.
- Category: J.
- Decision: Correct supported surface, then Keep.
- Tests/cases: six filesystem-adapter cases and three internal-schema cases.
- Production owner: internal MCP filesystem tool catalog and dispatcher.
- Protected contract or plausible defect: `fs_watch_directory` was returned to
  models but had no dispatch branch or implementation, so every advertised call
  failed as an unknown tool.
- Evidence: the unsupported entry was removed; the catalog-copy owner now pins
  the 11 supported operations and explicitly excludes watch. Historical plain
  RisuAI contained the same advertisement/dispatcher mismatch and no hidden
  implementation.
- Companion/overlap analysis: per-operation tests could not detect a catalog
  entry with no handler; schema cloning protects a different mutation boundary.
- Action and rollback: do not advertise watch unless a bounded, cancellable
  browser implementation and lifecycle contract are added.
- Validation: focused filesystem/internal-client cases, exact Phase 10 owners,
  client typecheck, and complete frontend passed.
- Count delta: one catalog regression added; no test owner removed.
- Revisit condition: an explicit supported directory-watch product design.

### TSA-P10-007: Extension-shaped names hid five dominant product risks

- State: Done.
- Severity: Medium.
- Category: J to B/C/G/K.
- Decision: Reclassify.
- Tests/cases: five complete unchanged owners / 39 cases listed by
  `phase10-reclassified` state in `inventory.json`.
- Production owner: encrypted browser draft recovery, targeted durable command
  writes, provider response/dashboard freshness, and save/asset diagnostics.
- Protected contract or plausible defect: plugin/module/tool vocabulary could
  hide a browser-state, persistence, provider, or asset/export failure mode.
- Evidence: executable exact-path rules move module-editor drafts to B,
  settings/plugin-storage range to C, plugin-provider and NanoGPT dashboard to
  G, and database analysis to K while retaining J seam tags.
- Companion/overlap analysis: runtime lane and specialized ownership remain
  unchanged.
- Action and rollback: retain all five owners unchanged under their corrected
  categories.
- Validation: 12/12 routing-policy cases and the regenerated 700-owner
  inventory passed.
- Count delta: one policy case; no owner removed.
- Revisit condition: only if a complete owner's dominant product contract
  changes.

### TSA-P10-008: Plugin security layers are intentional defense in depth

- State: Done.
- Severity: Informational.
- Category: J/L.
- Decision: Keep.
- Tests/cases: plugin network, icon, update, import, command, sandbox, and
  lifecycle owners in the reviewed set.
- Production owner: client permission identity, sandbox capability surface,
  authenticated proxy transport, authoritative DNS/redirect/cap checks, and
  durable plugin state.
- Protected contract or plausible defect: merging permissive client doubles
  with server inject tests would hide denial side effects, redirects, DNS,
  runtime cleanup, or stale plugin authority.
- Evidence: complete review found distinct failure oracles. A real Chromium
  probe mounted the production icon component: active/subresource SVG vectors
  generated zero requests and script signals, and opaque guest `blob:null`
  content was refused. Base64 SVG is already rejected.
- Companion/overlap analysis: Happy-DOM cannot establish browser SVG image
  restrictions, while browser rendering alone cannot prove authoritative SSRF
  checks.
- Action and rollback: retain layered owners; treat arbitrary blob acceptance
  as optional Low defense-in-depth hardening, not a confirmed egress defect.
- Validation: exact owners, Fastify plugin network cases, and Chromium 1.62.1
  host/opaque-origin probes passed.
- Count delta: none.
- Revisit condition: a browser or standards change that permits active SVG
  subresources in image mode.

### TSA-P10-009: Specialized-tool UI and service owners remain distinct

- State: Done.
- Severity: Informational.
- Category: J with D/G/K seams.
- Decision: Keep.
- Tests/cases: the complete Playground, Iris-adjacent, module, MCP UI, and
  specialized-tool owners in the reviewed set.
- Production owner: visible execution, stable target/input snapshots, partial
  success, retry, cancellation, downloads/assets, and backing service protocol.
- Protected contract or plausible defect: consolidating by tool name would
  replace visible outcome/cleanup proof with service-call assertions or vice
  versa, leaving wrong-target, stuck-busy, transport, or persistence defects
  invisible.
- Evidence: mounted components and pure/service owners were traced through
  separate state, protocol, asset, and lifecycle seams; no pair met the
  mandatory merge/removal proof.
- Companion/overlap analysis: test doubles reduce browser/media realism but do
  not make their stale-input and visible-retry oracles equivalent to adapters.
- Action and rollback: retain the separate owners and address browser
  composition only through a bounded gap owner.
- Validation: 619/619 exact opening-owner cases after remediation and complete
  frontend/Fastify lanes passed.
- Count delta: none beyond the focused regressions above.
- Revisit condition: Phase 13 may consolidate only with complete visible and
  service-layer replacement proof.

### TSA-P10-010: Extension and specialized-tool guidance needed the final audit state

- State: Done.
- Severity: Low.
- Category: J/A.
- Decision: Correct documentation.
- Tests/cases: the two Phase 10 discovery guides and complete reviewed set.
- Production owner: authoritative testing guidance for extension/tool support,
  strengths, and residuals.
- Protected contract or plausible defect: the guides predated body deadlines,
  pagination/frame bounds, stable-owner fences, module identity invalidation,
  delayed-listener cancellation, image teardown, and the supported filesystem
  catalog.
- Evidence: source, fresh collection, exact runs, and Chromium icon evidence
  establish the current contracts and count deltas.
- Companion/overlap analysis: stale guidance can turn intentional layers into
  apparent duplication or overstate mock/browser confidence.
- Action and rollback: update both guides with the landed contracts and bounded
  residual owners.
- Validation: documentation formatting, inventories, and linked commands pass.
- Count delta: none.
- Revisit condition: update the guides with future material support changes.

### TSA-P10-011: Live extension/tool composition and support-policy claims are bounded

- State: Deferred with retained owners and explicit phase ownership.
- Severity: High.
- Category: J, with K/L and Phase 11/12/13/14 ownership.
- Decision: Keep current bounded evidence; add or change support only at the
  named owners.
- Tests/cases: sandbox/permission doubles, MCP transports and internal clients,
  module/RisuAccess imports, Playground/media components, smoke, and
  compatibility.
- Production owner: imported-asset failure cleanup, plugin proxy authority
  threat model, independently implemented MCP/OAuth interoperability, browser
  iframe/File-System/canvas/codec behavior, signed update provenance, and
  Google/AI internal-client product support.
- Protected contract or plausible defect: controlled transports and mounted
  DOM cannot establish all production-browser and external-server behavior.
  Product policy has not selected signed plugin provenance, arbitrary internal
  AI model support, or whether the Google client is a supported Fastify path.
  Module/RisuAccess uploaded-asset cleanup belongs to the asset transaction
  boundary rather than this phase.
- Evidence: all confirmed High lifecycle, identity, and unbounded-request paths
  found here are fixed. Chromium closes the suspected SVG egress path. The
  remaining items require authoritative asset, platform threat-model, or
  bounded live-composition evidence; the historical baseline is absent.
- Companion/overlap analysis: Phase 11 owns upload/asset cleanup; Phase 12 owns
  proxy authorization and runtime observability; Phase 13 owns bounded browser
  and local MCP composition plus support decisions; Phase 14 owns final
  residual and historical-compatibility verdict.
- Action and rollback: retain current bounded layers. Do not infer live
  interoperability from doubles, add paid/network calls, broaden plugin
  authority, substitute a baseline, or refresh goldens.
- Validation: exact, complete, type, build/smoke, inventory, and current-only
  compatibility lanes bound current claims.
- Count delta: none.
- Revisit condition: Phase 11 asset audit, Phase 12 security/runtime audit,
  Phase 13 bounded remediation, and mandatory Phase 14 closeout decision.

## Phase 11 Findings

### TSA-P11-001: Portable exports discarded reroll alternatives

- State: Done.
- Severity: High.
- Category: K.
- Decision: Strengthen, then Keep.
- Tests/cases: ordinary save export/import route owners; two regressions.
- Production owner: portable chat-message projection and alternate-message
  restoration.
- Protected contract or plausible defect: exporting only the active message
  made other reroll candidates disappear after import.
- Evidence: export now joins durable alternates and import restores alternate
  rows; route round trips assert all candidates and active selection.
- Companion/overlap analysis: browser swipe persistence proves reload behavior,
  not portable serialization.
- Action and rollback: retain explicit alternate projection in both directions.
- Validation: focused routes, 568 exact opening-owner cases, complete lanes.
- Count delta: two cases.
- Revisit condition: any new message-variant representation.

### TSA-P11-002: Malformed save directories could drive unbounded work

- State: Done.
- Severity: High.
- Category: K/L.
- Decision: Strengthen, then Keep.
- Tests/cases: bounded inflate and codec framing regressions.
- Production owner: legacy/current `.risu` directory and physical-block decoder.
- Protected contract or plausible defect: invalid compression markers,
  excessive directory references, or oversized synthetic names could consume
  memory/CPU before normalized validation.
- Evidence: marker validation, a 65,536-reference cap, 255-byte synthetic-name
  cap, and cache-only dedupe now fail at the framing boundary.
- Companion/overlap analysis: expanded-byte caps cannot bound entry metadata or
  ambiguous physical directories.
- Action and rollback: retain independent byte and cardinality bounds.
- Validation: focused malformed matrices and complete Fastify lane passed.
- Count delta: three codec regressions are included with TSA-P11-003.
- Revisit condition: a new envelope family or deliberately raised cap.

### TSA-P11-003: Duplicate blocks and archive entries were ambiguous

- State: Done.
- Severity: Critical.
- Category: K.
- Decision: Strengthen, then Keep.
- Tests/cases: five codec and four bundle-import regressions.
- Production owner: block-envelope assembly and bundle archive validation.
- Protected contract or plausible defect: duplicate physical names, singleton
  types, root keys, or ZIP entries could silently select one attacker-controlled
  value through last-write-wins behavior.
- Evidence: the decoder rejects every duplicate ownership class; bundle import
  caps entries at 10,000, names at 1,024 bytes, rejects duplicates, and requires
  exact `database.risu` cardinality.
- Companion/overlap analysis: normalized-shape validation happens too late to
  establish unambiguous physical ownership.
- Action and rollback: fail closed before durable import.
- Validation: codec/bundle matrices, exact server owners, complete lane passed.
- Count delta: nine cases across TSA-P11-002/003.
- Revisit condition: any archive layout or multi-component format change.

### TSA-P11-004: Legacy portable backup rewrites omitted asset owners

- State: Done.
- Severity: High.
- Category: K.
- Decision: Add and Strengthen.
- Tests/cases: new `localBackupDatabase.test.ts`, three cases.
- Production owner: recursive legacy local-asset rewrite for portable backups.
- Protected contract or plausible defect: known asset fields outside the old
  allowlist remained machine-local and broke after restore elsewhere.
- Evidence: the rewrite now traverses the complete persisted shape and rewrites
  all legacy local references while preserving unrelated strings.
- Companion/overlap analysis: current save walkers did not execute this legacy
  browser backup path.
- Action and rollback: keep the direct production owner; update it with future
  persisted asset owners or replace it with a shared catalog/parity contract.
- Validation: 3/3 direct cases and complete frontend/Fastify/inventory gates.
- Count delta: one owner and three cases added.
- Revisit condition: Phase 13 central asset-owner catalog decision.

### TSA-P11-005: Failed Realm/CharX imports leaked newly written assets

- State: Done.
- Severity: High.
- Category: K.
- Decision: Strengthen, then Keep.
- Tests/cases: three Realm import failure regressions.
- Production owner: server CharX asset staging, conversion, append, and command
  settlement.
- Protected contract or plausible defect: mid-write, conversion, or append
  failure left orphaned content-addressed bytes and metadata.
- Evidence: failure cleanup tracks new writes, removes them on every terminal
  path, and preserves pre-existing deduplicated assets.
- Companion/overlap analysis: route rejection and GC grace periods could not
  prove immediate transactional cleanup.
- Action and rollback: retain per-import ownership cleanup until a repository
  transaction spans asset bytes and character commit.
- Validation: 30/30 Realm cases and isolated 7,000-asset owner passed.
- Count delta: three cases.
- Revisit condition: transactional asset/character repository composition.

### TSA-P11-006: Background inlay and PDF failures leaked work or rejection

- State: Done.
- Severity: High.
- Category: B/G with K seams.
- Decision: Strengthen and Reclassify.
- Tests/cases: one inlay-migration and three PDF lifecycle regressions.
- Production owner: background legacy inlay migration and PDF page/canvas
  rendering cleanup.
- Protected contract or plausible defect: an unobserved migration rejection
  escaped startup work; render, data-URL, or abort failures retained page/canvas
  resources.
- Evidence: background migration rejection is contained and every PDF exit path
  closes the page and releases canvas state.
- Companion/overlap analysis: happy-path media/import assertions could not
  observe terminal resource ownership.
- Action and rollback: keep explicit cleanup at the owning async boundary.
- Validation: focused frontend owners and complete frontend lane passed.
- Count delta: four cases.
- Revisit condition: real-browser decoder composition in Phase 13.

### TSA-P11-007: Asset-adjacent names hid seventeen dominant product risks

- State: Done.
- Severity: Medium.
- Category: K to B/C/D/E/G/L.
- Decision: Reclassify.
- Tests/cases: 17 complete unchanged owners / 134 opening cases.
- Production owner: durable imports, browser state, visible backup feedback,
  stale-safe authoring, PDF lifecycle, and platform file capabilities.
- Protected contract or plausible defect: broad import/export vocabulary could
  hide the contract whose failure actually determines user risk.
- Evidence: exact first-match rules and executable counterexamples preserve the
  asset seam while assigning each owner to its dominant category.
- Companion/overlap analysis: runtime lanes and specialized tags are unchanged.
- Action and rollback: retain all owners unchanged under corrected categories.
- Validation: 13/13 routing-policy cases and 700-owner inventory passed.
- Count delta: one policy case; no owner removed.
- Revisit condition: only if a complete owner's dominant contract changes.

### TSA-P11-008: Fastify mode could emit unusable remote-block saves

- State: Done.
- Severity: High.
- Category: B/K.
- Decision: Strengthen and Reclassify.
- Tests/cases: two browser save-mode cases, including one formerly vacuous case.
- Production owner: RisuSave output-mode selection under Fastify ownership.
- Protected contract or plausible defect: preferred or forced remote blocks
  could create a save whose cache references were not portable from Fastify.
- Evidence: Fastify mode always selects inline output and both preference paths
  assert the production selection.
- Companion/overlap analysis: codec classification could reject remote blocks
  but did not prevent the browser from choosing them.
- Action and rollback: retain the Fastify gate until a supported remote block
  service exists.
- Validation: focused owner and complete frontend lane passed.
- Count delta: one effective case.
- Revisit condition: an explicit portable remote-block product contract.

### TSA-P11-009: Asset/save layers are intentional defense in depth

- State: Done.
- Severity: Informational.
- Category: K.
- Decision: Keep.
- Tests/cases: 25 current K owners / 433 cases.
- Production owner: asset bytes/index/references, backup transactions, codecs,
  routes, browser adapters, Realm staging, and compatibility diagnostics.
- Protected contract or plausible defect: merging by feature name would replace
  physical framing, durable transaction, browser ownership, or recovery proof
  with a non-equivalent layer.
- Evidence: complete review found distinct failure oracles at every retained
  boundary; destructive restore covers rollback, ambiguous commit, forward
  completion, and boot recovery.
- Companion/overlap analysis: current synthetic fixtures reduce historical
  confidence but do not make byte, API, storage, and UI layers equivalent.
- Action and rollback: retain reviewed owners and their isolated Realm scale
  lane.
- Validation: exact opening owners, full lanes, scale, smoke, and inventories.
- Count delta: none beyond focused findings.
- Revisit condition: consolidation requires the full mandatory replacement proof.

### TSA-P11-010: The Kei backup adapter was test-only and unreachable

- State: Done.
- Severity: Low.
- Category: K.
- Decision: Remove.
- Tests/cases: `src/ts/kei/backup.test.ts`, five cases; production seam
  `src/ts/kei/backup.ts`.
- Production owner: none; only the deleted test imported the adapter.
- Protected contract or plausible defect: the suite maintained pagination,
  retry, and UI state for a path with no app, route, component, or module caller.
- Evidence: repository-wide static import and caller search found no production
  reachability; active backup clients and routes protect supported behavior.
- Companion/overlap analysis: removal does not claim equivalence; it records an
  obsolete, unreachable contract.
- Action and rollback: delete the test and seam and remove inventory/support
  references. Restore only with a real product caller and current contract.
- Validation: exact retained owners, complete frontend, discovery, support and
  effectiveness inventories passed.
- Count delta: one owner and five cases removed; one mixed seam removed.
- Revisit condition: a deliberate Kei backup feature returns.

### TSA-P11-011: Asset/save guidance did not describe current safety boundaries

- State: Done.
- Severity: Low.
- Category: K/A.
- Decision: Correct documentation.
- Tests/cases: Phase 11 discovery guide and complete reviewed set.
- Production owner: authoritative testing guidance for supported formats,
  cleanup, caps, scale ownership, and fixture provenance.
- Protected contract or plausible defect: stale guidance overstated historical
  independence and retained a deleted Kei path while omitting new ambiguity and
  rollback protection.
- Evidence: source, fixture provenance, fresh collection, exact runs, and
  generated inventories establish the current contracts.
- Companion/overlap analysis: guidance is the durable boundary between strong
  current evidence and intentionally bounded historical/browser claims.
- Action and rollback: keep the guide aligned with material support changes.
- Validation: documentation formatting, inventories, and linked commands.
- Count delta: none.
- Revisit condition: a format, cap, or fixture-provenance change.

### TSA-P11-012: Large-corpus, abort, browser, and historical claims are bounded

- State: Deferred with retained owners and explicit phase ownership.
- Severity: High.
- Category: K, with L and Phase 12/13/14 ownership.
- Decision: Keep current bounded evidence; add only at named owners.
- Tests/cases: archive/save routes, Realm/CharX, process ZIP, backup, smoke, and
  compatibility fixtures.
- Production owner: post-upload request cancellation, streaming export/import,
  browser fallback archive conversion, central asset-owner parity, destructive
  browser composition, and independent historical interoperability.
- Protected contract or plausible defect: disconnect may not cancel decode or
  destructive apply; large export/import paths can still materialize whole
  corpora; browser ZIP/Realm fallback remains less bounded; current block/ZIP/
  SQLite fixtures cannot independently prove historical compatibility.
- Evidence: confirmed ambiguity, cleanup, portability, and reference defects
  are fixed. Remaining claims require runtime policy, bounded browser
  composition, or historical artifacts unavailable in this checkout.
- Companion/overlap analysis: Phase 12 owns abort/limits/observability; Phase 13
  owns streaming/parity/browser composition; Phase 14 owns the final historical
  and residual-support verdict.
- Action and rollback: retain bounded layers. Do not infer unsupported live or
  historical behavior, substitute the pinned baseline, or refresh goldens.
- Validation: exact/full/scale/smoke/current-compatibility gates bound current
  claims; the differential harness reports the missing pinned worktree.
- Count delta: none.
- Revisit condition: Phases 12-13 remediation and mandatory Phase 14 closeout.
