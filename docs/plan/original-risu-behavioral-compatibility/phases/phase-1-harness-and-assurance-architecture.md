# Phase 1 — Harness And Assurance Architecture

Status: Pending  
Depends on: Phase 0

## Objective

Make compatibility evidence reproducible in local development and automation,
with explicit ownership for baseline preparation, fixtures, normalizers,
expected differences, affected-test selection, CI cadence, and release gates.

## Audit Questions

- Can a clean environment materialize and verify the exact fork-point baseline
  without relying on the moving upstream checkout?
- Do baseline and current runners execute the same semantic cases and emit
  comparable artifacts?
- Can normalizers hide a missing/null, order, endpoint, role, or metadata defect?
- Does every expected difference fail closed when its decision disappears or its
  observed shape changes?
- Do affected paths, aggregate scripts, CI, and release checks invoke the right
  compatibility lanes?
- Are browser-only, server-only, fault, round-trip, and structural surfaces
  assigned to a complementary evidence owner?

## Required Outputs

- Reproducible pinned-baseline preparation, integrity check, and diagnostics.
- Shared scenario registry and semantic result format used by both runners.
- Normalizer contract with adversarial negative cases.
- Decision-backed expected-difference registry; no anonymous golden exceptions.
- Fixture provenance and review rules; golden updates require semantic review.
- Closed-world checks for test/vocabulary ownership where practical.
- Documented PR, affected-path, nightly, and release schedule for current-only
  and full differential lanes.
- Artifact retention and failure triage instructions.

## Exit Criteria

- A fresh environment can run the pinned differential from documented inputs.
- Deliberate semantic mutations fail the harness; permitted noise normalizes.
- Every expected difference resolves to a signed decision and inventory rows.
- `test:affected`, aggregate commands, CI, and release policy have tested,
  documented ownership.
- Phase 2-12 slices can consume shared fixtures without inventing new authority
  or comparison rules.

## Validation

Run focused harness tests, mutation/negative tests, `pnpm test:affected
--dry-run`, every selected lane, `pnpm test:compat-current`, the pinned
`pnpm test:compat-harness`, aggregate runner tests when changed, formatting, and
`git diff --check`.
