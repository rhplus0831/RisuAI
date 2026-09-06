# Phase 9: Scripting, Parsing, Triggers, And Automation

Status: Complete on 2026-08-29; Phases 0-1 and Phase 6 prompt/display contracts satisfied.

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
[`scripting-parsing-and-automation.md`](../../../../docs/tests/scripting-parsing-and-automation.md).

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

## Completed Audit Record

Phase 9 opened with 43 category-I owners and 544 cases, including 31
parameterized rows: 36 frontend owners / 305 cases and seven Fastify owners /
239 cases. Both frozen opening sets passed before remediation. Thirty
regressions were added inside opening owners, and the exact opening set then
passed 325/325 frontend cases and 249/249 Fastify cases.

Four unchanged owners / 16 cases were reclassified to D/F/G/L after their
complete families were reviewed. The current I set is 39 owners / 558 cases /
45 parameterized rows: 32 frontend owners / 309 cases and seven Fastify owners /
239 cases. There is no built-browser I owner.

### Semantic Contract And Disposition Map

| Boundary | Current evidence and protected contract | Disposition |
| --- | --- | --- |
| CBS and template parsing | Conditions, loops, history, escapes, variables, reinjection, normalization, and recursion budgets | Keep; server call-stack propagation fixed |
| Chat/message parsing | Sentence grouping, ChatML, chat variables, parser fast paths, assets, and inlays | Keep distinct parser/resource owners; partial-edit projection moves to D |
| Regex execution | Server complexity/timeout/output bounds; browser Worker preemption and output caps; trigger compile-time complexity gate | Keep; unsafe execution and amplification fixed |
| Regex definitions and caches | Import normalization, editor behavior, prepared/compiled/result cache identity, ordering, and reload | Keep; result key collision fixed |
| Trigger schema and execution | Nested import shape, V1/V2 control/effects, budgets, memoization, resource guards, and server data effects | Keep I owners; generation/provider companions move to F/G |
| Lua and Python | Client cache/state/access cleanup, Lua budgets and egress, Python init/call deadlines, and retry | Keep; poisoned states, missing deadlines, and UTF-8 byte accounting fixed |
| Display sources | Server preparation/cache, client protocol/reload, ephemeral state, and output projection | Keep distinct evidence layers |
| Scripting-adjacent platform/UI | Hub HTML transport and visible partial-edit projection | Reclassify to L/D; retain tests unchanged |

No owner met the mandatory merge or removal proof. Parser, definition/editor,
runtime, cache, durable-effect, protocol, and projection evidence shares
vocabulary but catches different failure modes.

### Findings And Remediation

- `TSA-P09-001` preserves CBS recursion budgets across the server adapter.
- `TSA-P09-002` rejects overlapping regex complexity, bounds every output, runs
  browser script regex in a preemptible Worker, and gates synchronous trigger
  patterns before main-thread execution.
- `TSA-P09-003` evicts failed Lua states and gives Python initialization and
  calls separate terminating deadlines; `TSA-P09-004` counts Lua response
  limits in UTF-8 bytes.
- `TSA-P09-005` validates nested Trigger V2 rows while preserving future types;
  `TSA-P09-006` replaces delimiter-shaped script cache keys with versioned
  tuples.
- `TSA-P09-007` records all four D/F/G/L routing corrections;
  `TSA-P09-008` and `TSA-P09-010` record why retained display and interpreter
  layers are distinct. `TSA-P09-009` corrects stale scripting-test guidance.

`TSA-P09-011` bounds the missing full CBS/trigger parity matrix, real Pyodide
and editor-to-runtime browser composition, queued server Lua cancellation, and
historical compatibility. Phase 12 owns queue/runtime observability, Phase 13
owns parity and browser composition, and Phase 14 owns the final residual and
compatibility verdict.

### Validation Summary

The complete ordinary frontend universe passed 6,740/6,740; the two isolated
performance owners passed 6/6. Complete Fastify passed 3,351 cases with one
intentional direct-only Realm scale skip. The exact reviewed opening set passed
574/574 cases after remediation. Focused interpreter, regex, trigger, cache,
and routing checks also passed.

Client and server typechecks, affected selection, linked inventories,
formatting, and diff checks passed. The production smoke build passed with the
existing allowed diagnostics and the Worker bundle; all 35/35 Chromium
journeys passed. Because no I browser owner executes a saved definition, smoke
is application regression evidence rather than an end-to-end scripting claim.

Current-only compatibility passed 18/18. Full differential compatibility is
blocked by the absent exact pinned worktree; no substitute checkout or golden
refresh was used.

Fresh lists and measured results record 700 live owners and 10,133 cases with
one direct-only skip and 1,308 parameterized rows. Live decisions are 521 Keep,
62 Reclassify, and 117 Pending. No test owner, fixture, or golden was removed.
