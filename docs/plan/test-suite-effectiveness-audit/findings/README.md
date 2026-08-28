# Test Suite Effectiveness Findings

Date: 2026-08-29

Status: Active; four findings are done and one remains confirmed.

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
