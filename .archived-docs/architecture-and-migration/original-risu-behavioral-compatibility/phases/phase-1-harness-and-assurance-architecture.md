# Phase 1 — Harness And Assurance Architecture

Status: Complete
Depends on: Phase 0
Completed at Fastify: `546ea5aaee78144176043971fdd2c13c9e7c6079`

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

Completed execution record:
[Phase 1 reproducible differential and gates](slices/phase-1-harness-and-assurance-architecture/phase-1-reproducible-differential-and-gates.md).

## Completion Evidence

- Pinned baseline, shared case/artifact schema, semantic normalizer, and governed
  fixtures, goldens, and expected differences:
  `b0f06552dc84fc8c406c7279cd6330519d6c4db1`, finalized with classified fixture
  provenance at `546ea5aaee78144176043971fdd2c13c9e7c6079`.
- Production correction exposed by semantic comparison:
  `c33dac56811c3c6c6bdf72f8ad3faac796abfe59`.
- Prompt-preview diagnostics and persisted transcript metadata were separated in
  follow-up `5b6a9d492beb399a58d9695097171a9c3edf1b4d`.
- Register, affected-selection, and aggregate ownership:
  `6ddc82431230ee40cf9c4151d3388baab0162998`.
- CI cadence, retained artifacts, and release-equivalent ownership:
  `328a70787c26051525a713fc86311fe672dd7b8b`.
- Category A rows `ORC-SURFACE-078` through `ORC-SURFACE-085` are the canonical
  inventory ownership record; exact command results are in
  [`latest-verification.md`](../latest-verification.md).
