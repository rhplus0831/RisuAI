# Agent-Preset Output References

Status: complete at `12d2840b1`.

Parent: [Phase 3](../../phase-3-pure-shared-core.md)

Depends on: shared-core internal-reasoning leaf at `251c9d043`.

## Objective

Move dependency-free agent-preset output-token discovery and expansion into the
audited shared-core owner without changing browser dependency validation or
Fastify prompt/agent execution.

## Source And Destination

- Source: `src/ts/agentPresetReferences.ts`.
- Destination: an explicit `@risuai/shared-core` subpath.
- Consumers: browser agent-preset resolution plus Fastify prompt-variable and
  agent-preset output expansion.

## Behavior Contract

- Preserve the exact `{{agent::key}}` grammar, optional whitespace, ASCII
  identifier start/continuation rules, and 64-character maximum.
- Preserve exact matched token text, UTF-16 match index, repeated-reference
  order, and callback order.
- Preserve unresolved tokens byte-for-byte through `resolveOutput(key) ?? token`.
- Do not trim, case-fold, normalize, coerce, or broaden keys.
- Do not change agent dependency validation, prompt assembly, execution order,
  output bounds, persistence, or UI behavior.

## Validation

Shared-core import audit/typecheck; focused differential fixtures for valid,
invalid, boundary-length, whitespace, repeated, unresolved, and UTF-16-index
cases; browser agent resolver and Fastify prompt/agent owners; both typechecks;
architecture inventory; formatting; and `git diff --check`.

## Done When

- All three production consumers use the shared subpath.
- The browser-tree implementation is deleted and both matching Fastify
  cross-runtime edges disappear without a new exception.
- Discovery metadata and expansion outputs match the pre-extraction behavior
  exactly.

Stop if the helper needs agent records, aggregate database state, prompt
assembly, persistence, browser reactivity, or host-specific behavior.

## Completion

- `AgentPresetOutputReference`, the exact matcher, discovery, and expansion now
  live at `@risuai/shared-core/agent-preset-output-references` with no runtime
  imports.
- Differential fixtures preserve key boundaries, optional whitespace, exact
  tokens, repeated order, callback order, unresolved identity, the 64-character
  limit, and UTF-16 indexes.
- Browser dependency resolution and both Fastify expansion consumers use the
  shared subpath. The browser-tree owner and two production root-`src` edges
  were removed.
- Shared-core ownership checks are part of the maintained boundary command,
  including the previously released internal-reasoning ownership proof.
