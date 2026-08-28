# Test Suite Effectiveness Audit

Date: 2026-08-29

Status: Active; Phase 1 is in progress.

This workstream audits the complete test system for effectiveness, not merely
for presence or coverage percentage. It asks whether each test can catch a
plausible defect, protect a user-visible behavior or durable contract, enforce a
deliberate architectural boundary, preserve compatibility, or guard a measured
resource budget.

The audit also identifies and removes "tests for the sake of testing": tests
that exercise code without providing meaningful regression protection,
behavioral assurance, security or data-integrity value, compatibility evidence,
or an explicit architectural policy. Fewer tests are not an objective. A large
suite that provides distinct protection is healthy; a small suite that creates
false confidence is not.

Start with:

1. [`status.md`](status.md) for the current phase, cursor, counts, decisions,
   and blockers.
2. [`plan.md`](plan.md) for scope, taxonomy, value rubric, invariants, removal
   safeguards, and phase order.
3. [`phases/README.md`](phases/README.md) for phase and slice routing.
4. [`findings/README.md`](findings/README.md) for the finding and decision
   record format.
5. [`latest-verification.md`](latest-verification.md) for reproducible command
   evidence and count changes.

## Baseline Anchor

The frozen planning baseline contains 698 tracked `*.test.ts` and `*.spec.ts`
files. Phase 0 added one focused inventory test, so the live checked universe is
699:

| Owner                               | Files | Notes                                                                    |
| ----------------------------------- | ----: | ------------------------------------------------------------------------ |
| Frontend Vitest                     |   537 | 194 Node, 17 Svelte+Node, 326 Happy-DOM in the full discovered universe. |
| Fastify Vitest                      |   154 | Node/fork tests under `server/fastify/__tests__/`.                        |
| Playwright browser smoke            |     7 | Built SPA with Chromium, Fastify, and SQLite.                             |
| Compatibility and support artifacts |     — | Opt-in runners, goldens, fixtures, helpers, configs, and setup files.     |

These are file-owner counts, not test-case counts or an effectiveness verdict.
Phase 0 froze the exact commit, discovered case counts, inventoried support
artifacts, and assigned every test file to one primary product-risk category.
See the Phase 0 slice and live machine-readable manifests for the current
counts and the intentional `+1` assurance-infrastructure delta.

[`frontend-routing-inventory.tsv`](frontend-routing-inventory.tsv) is the live
checked N/S/D/B capability manifest. It is intentionally separate from the
effectiveness inventory because runtime placement and audit disposition are
different contracts.

## Working Principle

A test earns retention by protecting at least one distinct, intentional
contract at an appropriate evidence layer. Apparent duplication can be valuable
defense in depth when unit, storage, API, DOM, and browser tests fail for
different reasons. Conversely, execution, coverage, snapshots, or assertion
count alone do not demonstrate value.

No test is removed by a score or aesthetic judgment. Every removal or merge
requires the evidence package in [`plan.md`](plan.md#removal-and-consolidation-proof),
including the contract disposition, replacement or overlap proof, affected
discovery and fixture cleanup, and the complete owning validation lane.

## Authority Boundary

This is an active investigation and remediation plan. Current behavior,
commands, routing, and test ownership remain authoritative in:

- [`package.json`](../../../package.json);
- the root Vitest and Playwright configuration files;
- [`docs/structure/testing-and-operations.md`](../../structure/testing-and-operations.md);
- [`docs/tests/README.md`](../../tests/README.md);
- [`server/fastify/__tests__/README.md`](../../../server/fastify/__tests__/README.md).

This plan does not supersede those sources. Update them only when an accepted
finding changes live behavior or test ownership.

## End State

- Every tracked test has one primary category, runtime/lane tags, a value class,
  an owning production contract, and an evidence-backed disposition.
- Unique high-risk behavioral, data-integrity, security, compatibility, and
  performance contracts remain protected at the right layer.
- Weak tests are strengthened; redundant tests are consolidated only when their
  failure modes are genuinely equivalent; obsolete or valueless tests and
  orphaned support code are removed.
- Material gaps discovered during the audit have regression proof or a recorded
  owner, reason, and concrete revisit condition.
- Test discovery, affected selection, coverage ownership, performance gates,
  browser smoke, compatibility goldens, local aggregate execution, and CI stay
  aligned.
- Every count delta and accepted residual is explained, and the complete quality
  aggregate is green before closeout.
