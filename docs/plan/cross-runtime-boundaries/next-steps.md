# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

## Current Best Task

Execute the [module-integration normalization
slice](phases/slices/phase-3-pure-shared-core/module-integration-normalization.md).

1. Move the zero-import parser, stable combiner, Agent-preset reference shape,
   and selected-preset lookup into an explicit shared-core subpath.
2. Preserve comma splitting, trimming, empty removal, parser duplicate order,
   combiner first-occurrence deduplication, and `", "` joining.
3. Preserve trimmed selected IDs, exact stored-ID matching, first-match
   selection, explicit disabled-preset exclusion, and verbatim integration
   output.
4. Migrate the two browser and one Fastify production consumers, then delete
   the browser-tree owner after differential and ownership proof.
5. Keep module activation, generation composition, persistence, command policy,
   and Agent execution unchanged.

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
- Agent-preset output references and all three production consumers are released
  at `12d2840b1`.
- Punctuation trimming and all four direct consumers are released at
  `386bdd750`.
- Inlay-token matching and both production consumers are released at
  `92dde59e1`.
- ChatML row parsing and all five production consumers are released at
  `14f44ed87`.
- History-slot rendering and all four production consumers are released at
  `7e03538ea`.
- Lore hash randomization is released at `1b1152814`; the browser facade and
  both Fastify owners share one implementation.
- Model-role resolution is released at `22d6799dd`; twenty browser and eight
  Fastify production consumers share one implementation.
- The Agent-only lorebook predicate is released at `4162150ec`; all four
  production consumers use the shared marker logic.
- Script-model overrides are released at `2831411d1`; seven browser and four
  Fastify production consumers share one implementation.

## Not In This Slice

- Do not move module activation, effective generation composition, database
  state, persistence, command policy, or Agent execution into shared core.
- Do not correct the persisted `moduleIntergration` spelling or broaden this
  slice into module records or Agent Preset normalization.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After this leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 only
with another independently justified neutral leaf.
