# Phase 14 — Verification And Closeout

Status: Complete
Depends on: Phase 13

## Objective

Prove the compatibility contract at a final Fastify commit, close every register,
make permanent gates operational, synchronize shipped documentation, and
archive the intact workstream.

The final behavioral candidate is
`a6b9cdcc074d4033c511509171268a821aa11d3c`. Its exact manifest passes; all four
registers are closed, current documentation was synchronized, and the intact
workstream was archived under Architecture and migration.

## Required Work

- Freeze the final Fastify verification commit and verify baseline/toolchain
  prerequisites and fixture provenance.
- Run the complete pinned fork-point differential and current-only compatibility
  suites with no unexplained differences.
- Run all owning product, structural, browser/recovery, round-trip, security,
  aggregate, formatting, and documentation gates required by the inventory.
- Confirm every expected difference resolves to a signed decision and every
  unsupported surface remains explicit.
- Reconcile inventory rows, raw mappings, findings, decisions, implementation
  commits, regression owners, residuals, and verification artifacts.
- Update `STRUCTURE.md`, `docs/structure/`, `src/docs/`, and `docs/tests/` where
  shipped behavior or test ownership changed.
- Move the complete workstream to `.archived-docs/` and update active/archive
  indexes only after all closeout evidence passes.

## Exit Criteria

- Every closure condition in `CONTRACT.md` passes.
- Full differential and current-only compatibility have zero unexplained
  differences at the recorded final commit.
- All Critical/High findings are fixed or individually accepted; every other
  open residual has owner, reason, and concrete revisit trigger.
- Permanent PR/nightly/release gates and baseline preparation are documented and
  operational.
- Current docs match shipped behavior and the archived plan remains internally
  linked and reproducible.

## Validation

Run the exact Phase 13 manifest, including focused/owning lanes,
`pnpm test:affected --dry-run`, all selected tests, `pnpm test:compat-current`,
the pinned `pnpm test:compat-harness`, required built-browser/recovery and
round-trip/security gates, `pnpm test:all`, formatting, link/schema checks, and
`git diff --check`. Record commands, outputs, commit, environment, and artifacts
in `latest-verification.md` before archiving.
