# Phase 9 — Scripting, Parsing, Triggers, And Automation

Status: Complete
Depends on: Phases 1, 3, 5-8

## Objective

Verify CBS parsing, regex, triggers, Lua, automation, and input/display/output
transformations, including ordering, scope, mutable state, execution bounds,
failure behavior, and explicit unsupported effects.

## Audit Questions

- Do shared parser fixtures preserve escaping, nesting, missing values, legacy
  syntax, roles, ordering, and repeated transformations?
- Are trigger conditions/effects evaluated in the same phase and against the
  same chat/message/profile state?
- Are script variables and Lua state scoped, persisted, reset, and exposed to
  later prompt/finalization steps consistently?
- Do errors, timeouts, recursion/budget limits, cancellation, and unsupported
  effects fail visibly before destructive or paid side effects?
- Do browser and server implementations drift for shared expressions or
  transformation pipelines?

## Required Outputs

- Shared baseline/browser/server parser and transformation fixture corpus.
- Closed-world trigger/effect/Lua API/unsupported-effect classification.
- Ordering/state-transition fixtures across input, prompt, output, display, and
  finalization phases.
- Resource-limit and failure diagnostics with adversarial negative cases.
- Browser outcomes for visible transforms and unsupported behavior.

## Exit Criteria

- Retained expressions, trigger effects, and script-visible state have shared
  semantic evidence at every consuming layer.
- Ordering and scope differences are fixed or individually signed.
- Unsupported effects are absent or explicit and cannot partially mutate state.
- Focused scripting/parser, generation, state, security, and compatibility lanes
  pass.

## Validation

Run shared fixture suites in every implementation, trigger/Lua integration and
limit tests, selected browser journeys, affected and compatibility lanes,
formatting, and `git diff --check`.

## Completion Record

- `08d04efbf6bcc0f64c706bafe454a8649f9971be` restores the baseline's
  malformed-chat `firstmsgindex` fallback and the retained whole-trigger abort
  boundary. Prior durable variable writes survive that abort, while transient
  trigger chat/prompt output cannot leak into input, start, recursive, or output
  consumers.
- `3963a1278b5f15175c295e3707d25fbf07bdcb56` closes all 176 CBS
  registrations, 151 executable callbacks, 245 normalized matcher names, 118
  effects, six modes, four condition kinds, four regex stages, and 54 Lua host
  APIs. Forty unsupported effects have an explicit no-op or diagnostic
  disposition.
- A shared corpus runs through the pinned baseline, browser parser, and Fastify
  adapter. Exact baseline/current fixtures separately pin group retirement,
  history windows, reverse, runtime metadata, standalone slots, the 4096-element
  each budget, missing `fmIndex`, and browser/server Lua failure behavior.
- Six previously unregistered but individually authorized differences are now
  signed as `ORC-DECISION-062` through `ORC-DECISION-067`. Group-aware CBS
  retirement is added to existing `ORC-DECISION-005`; its exact RH+ authority
  is `58bd2b2d54f9f1fbdb35130b3fc4e0176b1d07a6`.
- Category I rows `ORC-SURFACE-109` through `ORC-SURFACE-117` own the new signed
  and closed-world surfaces. All nine historical Category I rows are
  independently re-verified; Category I is 18/18 verified, the inventory has
  117 rows, and all 67 decisions are signed.

## Completion Validation

| Check | Result |
| --- | --- |
| Phase 9 Fastify selection | Passed; 6 files and 359 tests. |
| Browser shared corpus and baseline-drift selection | Passed; 2 files and 24 tests. |
| `pnpm test:compat-harness` | Passed; 29 baseline tests, 18 current/cluster tests, 16 compared cells, 15 governed harness divergences, and healthy cluster 10. |
| `pnpm check` | Passed with 0 errors and 0 warnings. |
| `pnpm check:server` | Passed protocol, client declarations, Fastify, and browser-smoke typechecks. |
| `pnpm validate:compat-registers` and fail-closed register Vitest | Passed; 117 surfaces, 67 signed decisions, 15 findings, and all historical raw mappings. |
| Prettier and `git diff --check` | Passed for the Phase 9 implementation, evidence, and closure files. |

Locale-sensitive matcher folding has no demonstrated registered-name outcome,
and the authorized shallow history clone has byte-identical output. Neither is
treated as a hidden compatibility difference; exact ASCII matcher ownership and
output bytes remain pinned.
