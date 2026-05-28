# Audit

Date: 2026-05-28

Read this when changing `util/client-thinning-audit.ts`, adding invariant
rules, or selecting audit fixture work.

## Current Audit

The executable audit is `pnpm client-thinning:audit`, defined in
`package.json`. The script uses `ts-morph` plus source-text checks over a
bounded source set.

Current structural rule families:

- passive bootstrap refresh writer ownership
- conflict replay outside central wrapper
- transitive command-path id minting
- globally addressed resolver normalization
- asset reference parser and validator parity
- wildcard secret row identity
- asset URL gate
- composite command fan-out
- backup data-directory inventory
- bounded process-lifetime accumulators
- `saveAsset` filename classification

## Open Work

Audit fixture reproducibility remains open: every audit rule should have a
committed pre-fix fixture and a `*.test.ts` proof that the rule exits non-zero
on that fixture.

The rule should catch the invariant class, not only the original spelling of a
past bug. Narrow rules need an explicit reason.

## Direction

- Add a fixture/test before claiming a rule complete.
- If a new bug appears, extend the invariant and audit in the same batch as the
  runtime fix.
- Keep one `pnpm client-thinning:audit` entry point even if internals split.
- Prefer source-derived rule inputs over hardcoded call-site lists.

## Proof Leads

- `pnpm client-thinning:audit`
- Future audit fixture tests
- `util/client-thinning-audit.ts`
