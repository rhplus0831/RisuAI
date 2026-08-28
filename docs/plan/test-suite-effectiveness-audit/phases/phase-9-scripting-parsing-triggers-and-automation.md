# Phase 9: Scripting, Parsing, Triggers, And Automation

Status: Pending; depends on Phases 0-1 and Phase 6 prompt/display contracts.

## Objective

Audit whether scripting and parsing tests protect semantics, bounded execution,
escaping, cache invalidation, target isolation, and client/server parity rather
than mirroring implementation details or accepting unsafe untrusted content.

## Scope

- CBS conditions, loops, history/index behavior, strings/escapes, variables, and
  template normalization.
- Regex scripts, edit/display transforms, cache/memo behavior, import/export,
  and bounded regex execution.
- Triggers, command automation, client budgets, output effects, and server
  trigger data effects.
- Lua runtime, state isolation, execution budgets, errors, and cleanup.
- HTML/chat parsing, Markdown/sanitization boundaries, additional assets/inlays,
  display-source protocol/cache, and server intermediate display processing.
- Input hooks and automated generation helpers where interpreter semantics are
  primary.

Primary discovery guide:
[`scripting-parsing-and-automation.md`](../../../tests/scripting-parsing-and-automation.md).

## Audit Questions

- Are parser/interpreter tests based on supported semantics and adversarial
  inputs, or on copied implementation branches?
- Do timeout/budget tests prove termination and cleanup under controlled load
  without brittle wall-clock assumptions?
- Is script state isolated by target, phase, and ephemeral/authoritative owner?
- Do cache/memo tests fail when invalidation, namespace, fingerprint, or bounds
  are wrong?
- Are source-shape allowlists explicit architecture/security policies or weak
  substitutes for runtime behavior?
- Do client/server CBS, lore, trigger, and display contracts have parity proof?

## Required Outputs

- Semantic contract/disposition map by interpreter/parser family.
- Adversarial and bounded-execution coverage map.
- Findings for copied expectations, weak cache tests, unbounded execution,
  source-string brittleness, stale script state, unsafe sanitization, and parity
  drift.
- Retained rationale for narrow policy/allowlist tests that enforce unique
  security or ownership boundaries.

## Exit Criteria

- Every Phase 9 test has a disposition and named semantic or safety contract.
- Unique parsing, escaping, execution-bound, cache, state-isolation, and parity
  behavior remains protected.
- Critical/High untrusted-content or unbounded-execution findings are resolved.
- Removed source-policy checks have stronger enforcement or runtime replacement.
- Count deltas and residual parity/adversarial gaps are recorded.

## Validation

- Focused parser/process/display frontend tests
- Focused Fastify scripts/triggers/Lua/display tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:server`
- Relevant UI/browser custom-HTML/display tests
- Isolated performance/budget gates where affected
- `pnpm format:check`
- `git diff --check`
