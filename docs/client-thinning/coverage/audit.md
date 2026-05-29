# Audit Coverage

Date: 2026-05-30

Canonical audit shard is [`../status/audit.md`](../status/audit.md) — read it for
the rule inventory and direction. This file records the proof state.

## Reproducibility: COMPLETE

- The audit runs via `pnpm client-thinning:audit` over a bounded source set.
- All 23 audit checks have committed pre-fix fixtures (plus bypass fixtures where
  a rule has a narrow allowed shape) wired into the harness.
- The harness is `util/client-thinning-audit.test.ts` (58 tests): it runs
  `util/client-thinning-audit.ts` against fixture roots under
  `util/client-thinning-audit-fixtures/<rule-slug>/` with
  `CLIENT_THINNING_AUDIT_CHECK_IDS` selecting the rule, asserting exit code and
  check id.
- Any NEW rule must ship the same fixture + test in the same batch.

## Robustness: The Four Defeated Rules Are Hardened (2026-05-30)

The four rules that sincere refactors had empirically defeated are now AST
invariants, each with a committed adversarial fixture that defeated the OLD rule
and fails the NEW one:

- `A4R2 conflict replay outside central wrapper` — `conflict-replay/failing-aliased-literals`
- `A4R7 asset URL gate` — `asset-url-gate/failing-inverted-fastify-guard`,
  `asset-url-gate/failing-widened-asset-url`
- `A4R-fanout composite command race` (the `.svelte` path) —
  `composite-command-fanout/failing-svelte-race`,
  `composite-command-fanout/failing-svelte-markup-race`,
  `composite-command-fanout/svelte-branch-bypass`
- `EC2 plugin storage gates` — `plugin-storage-gates/failing-ungated-new-method`

Some other rules remain string/regex matchers but were not empirically defeated;
moving them to AST invariants is gated on demonstrating a defeat first. See
[`../status/audit.md`](../status/audit.md).

The group-chat removal added one AST invariant, `A4R-group-chat-removed`, with its
fixtures: `group-chat-removed/failing-ui-branch`,
`group-chat-removed/keep-layers-removed-bypass`, `group-chat-removed/passing`.

## Commands

```sh
pnpm client-thinning:audit
pnpm exec vitest run util/client-thinning-audit.test.ts
```
