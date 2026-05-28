# Audit

Date: 2026-05-29

Read this when changing `util/client-thinning-audit.ts`, adding invariant
rules, or selecting audit fixture work.

## Current Audit

The executable audit is `pnpm client-thinning:audit`, defined in
`package.json`. The script uses `ts-morph` plus source-text checks over a
bounded source set.

Current structural checks:

- `EC5 active-writer guard`
- `EC4 stable command ids`
- `EC2 plugin storage gates`
- `EC6 asset walker validator drift`
- `AEC2 import/export current shape`
- `AEC4 chat folder identity scope`
- `AEC5 module reference semantics`
- `AEC6 asset persistence semantics`
- `EC1 provider ownership`
- `A4R1 passive refresh writer ownership`
- `A4R2 conflict replay outside central wrapper`
- `A4R3 transitive command-path id minting`
- `A4R4 globally-addressed resolver normalize`
- `A4R5 asset reference parser parity`
- `A4R6 wildcard secret row identity`
- `A4R7 asset URL gate`
- `A4R-fanout composite command race`
- `A4R-backup data dir inventory`
- `A4R-bounded process-lifetime accumulators`
- `A4R-saveasset filename classification`

The fixture inventory for these checks lives in
[`../coverage/audit.md`](../coverage/audit.md).

## Open Work

Audit fixture reproducibility remains open for the remaining rule families:
every audit rule should have a committed pre-fix fixture and a `*.test.ts`
proof that the rule exits non-zero on that fixture.

The rule should catch the invariant class, not only the original spelling of a
past bug. Narrow rules need an explicit reason.

The rule inventory is complete as of 2026-05-29. The reusable fixture harness
now lives in `util/client-thinning-audit.test.ts`; it runs
`util/client-thinning-audit.ts` against committed fixture roots with
`CLIENT_THINNING_AUDIT_CHECK_IDS` selecting the intended rule and asserts exit
code, stdout/stderr, and check id.

First fixture proof is complete for `A4R-saveasset filename classification`.
The next small rule-family proof should be `A4R-backup data dir inventory`
unless source inventory reveals a more urgent audit-rule gap.

## Direction

- Add a fixture/test before claiming a rule complete.
- Put proposed fixtures under
  `util/client-thinning-audit-fixtures/<rule-slug>/` unless the harness chooses
  a clearer local path.
- Keep fixture source minimal: include only the files required by the audited
  `sourcePaths`, plus a `tsconfig.json` if the harness runs the audit with the
  fixture directory as `cwd`.
- If a new bug appears, extend the invariant and audit in the same batch as the
  runtime fix.
- Keep one `pnpm client-thinning:audit` entry point even if internals split.
- Prefer source-derived rule inputs over hardcoded call-site lists.

## Proof Leads

- `pnpm client-thinning:audit`
- `pnpm exec vitest run util/client-thinning-audit.test.ts`
- `util/client-thinning-audit.ts`
