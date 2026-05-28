# Phase 2: Audit Reproducibility

Date: 2026-05-29

Status: DONE.

Every client-thinning audit rule has a committed pre-fix fixture (plus a bypass
fixture where a rule has a narrow allowed shape) and a test that proves the rule
exits non-zero on that fixture. All 20 rules are covered by 41 tests in
`util/client-thinning-audit.test.ts`, run via `pnpm client-thinning:audit`.

Residual gap carried forward: ~12 of the 20 rules are string/regex matchers and
four (`A4R2`, `A4R7`, the fanout `.svelte` path, `EC2`) were empirically defeated
by sincere refactors. Converting those to AST invariants is **audit-rule
hardening**, tracked into phase 5. See
[`../coverage/audit.md`](../coverage/audit.md) and
[`../status/audit.md`](../status/audit.md).
