# ChatML Row Parsing

Status: complete at `14f44ed87`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core inlay-token matching at `92dde59e1`.

## Objective

Move dependency-free ChatML row parsing into the audited shared-core owner
without changing browser parsing/agent authoring or Fastify prompt and agent
execution.

## Source And Destination

- Source: `src/ts/parser/chatMLCore.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: browser ChatML parsing, agent-preset validation, and agent editor;
  Fastify prompt templates and agent-preset execution.

## Behavior Contract

- Preserve the exact `<|im_start|>`, `<|im_sep|>`, and `<|im_end|>` markers,
  initial `trim()`, and null result for non-ChatML input.
- Preserve role recognition with separator, space, or newline; unknown rows
  default to `user` without consuming content.
- Preserve per-row trimming, one terminal end-marker removal, greedy multiline
  `<Thoughts>` extraction order, and empty thought replacement.
- Invoke the content transform only after row boundaries and thought extraction
  so substitutions cannot inject additional rows.
- Do not move CBS expansion, agent records, validation, execution, prompt
  assembly, persistence, or UI state.

## Validation

Shared-core import audit/typecheck; copied differential fixtures for invalid
input, marker/role variants, unknown roles, whitespace, terminal markers,
multiline/multiple thoughts, callback order, and injection resistance; all five
production owners; both typechecks; architecture inventory; formatting; and
`git diff --check`.

## Done When

- All five production consumers use the shared subpath.
- The browser-tree implementation is deleted and both matching Fastify
  root-`src` edges disappear without a new exception.
- Existing ChatML and agent/prompt owning suites pass byte-for-byte behavior.

Stop if the parser needs CBS, browser state, Fastify, persistence, credentials,
or host-specific behavior.

## Release Evidence

- `@risuai/shared-core/chatml-rows` owns the parser and all five production
  consumers import that subpath.
- Differential, ownership, and import-boundary suites passed 13, 1, and 2
  tests; affected browser owners passed 5, 14, and 14, while affected Fastify
  owners passed 71 and 25.
- The browser-tree implementation was deleted and two production runtime/mixed
  root-`src` edges plus one target left the checked inventory.
