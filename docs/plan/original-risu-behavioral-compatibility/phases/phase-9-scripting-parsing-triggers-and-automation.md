# Phase 9 — Scripting, Parsing, Triggers, And Automation

Status: Pending  
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
