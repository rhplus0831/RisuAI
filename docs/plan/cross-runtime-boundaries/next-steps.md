# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

## Current Best Task

Execute the [agent-preset output references
slice](phases/slices/phase-3-pure-shared-core/agent-preset-output-references.md).

1. Move `AgentPresetOutputReference`, the exact token matcher, discovery, and
   expansion into an explicit shared-core subpath.
2. Preserve identifier boundaries, optional whitespace, exact token/index
   metadata, repeated callback order, and unresolved-token identity.
3. Migrate browser agent dependency resolution plus Fastify prompt-variable and
   agent-execution consumers together.
4. Delete `src/ts/agentPresetReferences.ts` only after differential fixtures and
   closed-world consumer ownership pass.
5. Keep agent validation, prompt assembly, execution, output bounds,
   persistence, and UI behavior unchanged.

## Foundations Released

- `@risuai/protocol/route-operation` publishes 103 stable route IDs and reviewed
  transport descriptors at `00e49d880`.
- Fastify owns a separate 103-entry auth/writer policy catalog joined by ID.
- `@risuai/protocol/durable-command-operation` publishes 129 stable retained
  command IDs and exact method/path matchers at `3f275e9dc`.
- Durable generation intent kinds point to the shared submit, cancel, and retry
  route IDs without replacing runtime generation UUIDs.
- Browser resource/cache/generation metadata publishes 55 reviewed route
  relations and seven explicit non-overlaps at `6a6d0ac1f`.
- `@risuai/shared-core` and the first duplicated chat-page leaf are released at
  `d798740f7`, with direct historical browser/Fastify oracle proof at
  `d78c67a3a`.
- Chat load-page normalization and all production consumers are released at
  `c12e807a5`.
- Chat display-tail normalization and both production consumers are released at
  `6fc15d7a1`.
- Regex output-size normalization and all eight production consumers are
  released at `83e8aabfa`.
- Legacy OpenAI model-alias normalization and all four production consumers are
  released at `23e5a4b30`.
- Internal-reasoning stripping and all five production consumers are released
  at `251c9d043`.

## Not In This Slice

- Do not move agent records, dependency graphs, prompt assembly/execution,
  persistence, or UI orchestration into shared core.
- Do not broaden the output-token grammar or normalize token/key text in this
  boundary move.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After this leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 only
with another independently justified neutral leaf.
