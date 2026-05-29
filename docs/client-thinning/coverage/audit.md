# Audit Coverage

Date: 2026-05-29

Canonical audit shard is [`../status/audit.md`](../status/audit.md) — read it for
the rule inventory and direction. This file records the proof state.

## Reproducibility: COMPLETE

- The audit runs via `pnpm client-thinning:audit` over a bounded source set.
- All 21 audit rules have committed pre-fix fixtures (plus bypass fixtures where
  a rule has a narrow allowed shape) wired into the harness.
- The harness is `util/client-thinning-audit.test.ts` (45 tests): it runs
  `util/client-thinning-audit.ts` against fixture roots under
  `util/client-thinning-audit-fixtures/<rule-slug>/` with
  `CLIENT_THINNING_AUDIT_CHECK_IDS` selecting the rule, asserting exit code and
  check id.
- Any NEW rule must ship the same fixture + test in the same batch.

## Caveat: Rules Not Uniformly Robust (OPEN)

Reproducibility is done, but several rules are string/regex matchers.
Four were empirically defeated by sincere refactors:

- `A4R2 conflict replay outside central wrapper`
- `A4R7 asset URL gate`
- `A4R-fanout composite command race` (the `.svelte` path)
- `EC2 plugin storage gates`

Audit-rule hardening — convert these four to AST invariants and add adversarial
fixtures — is the open work item. See [`../status/audit.md`](../status/audit.md).

## Commands

```sh
pnpm client-thinning:audit
pnpm exec vitest run util/client-thinning-audit.test.ts
```
