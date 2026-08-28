# Test Suite Effectiveness Findings

Date: 2026-08-29

Status: Active; two Phase 0 findings are confirmed.

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

- State: Confirmed; routed to Phase 1.
- Severity: Medium.
- Category: A, with F/L seams.
- Decision: Strengthen.
- Tests/cases: `packages/protocol/src/importBoundary.test.ts`, complete case.
- Production owner: browser-safe `packages/protocol` runtime/export boundary.
- Protected contract or plausible defect: nested runtime files, dynamic imports,
  or `require` can introduce Node-only or outside-package dependencies without
  failing the current non-recursive static-regex test.
- Evidence: current discovery reads only top-level runtime files and its regex
  recognizes static import/export syntax. Types and package exports do not
  independently reject every credible dependency shape.
- Companion/overlap analysis: `check:protocol` protects types and compilation,
  not the complete browser/dependency policy. The architecture test remains the
  right evidence owner after strengthening.
- Action and rollback: Phase 1 must first demonstrate nested/dynamic negative
  fixtures, then use recursive TypeScript-AST or import-graph enforcement. A
  strengthening can be rolled back independently without changing runtime.
- Validation: focused policy fixtures, `pnpm check:protocol`, frontend Node
  lane, and the exhaustive inventory checks.
- Count delta: None in Phase 0.
- Revisit condition: Phase 1 assurance policy slice.

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
