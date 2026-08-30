# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

## Current Best Task

Execute the [agent-only lorebook predicate
slice](phases/slices/phase-3-pure-shared-core/agent-only-lorebook-predicate.md).

1. Move only the portable marker constant and predicate into an explicit
   shared-core subpath with a narrow structural input.
2. Preserve nullish handling and strict `=== true` checks for both `agentOnly`
   and `extentions.risu_agent_only`.
3. Preserve the extension fallback when the direct field is false; do not
   coerce truthy values or mutate entries.
4. Migrate the browser Agent-input/export module, browser lorebook settings and
   processing, and Fastify lorebook filtering, then add a closed-world ownership
   proof.
5. Keep Agent input resolution, scope precedence, activation validation,
   cloning, Original Risu export projection, persistence, and UI orchestration
   unchanged.

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

## Not In This Slice

- Do not move Agent input resolution, Original Risu export projection, cloning,
  database types, activation validation, prompt filtering, or UI orchestration
  into shared core.
- Do not correct the persisted `extentions` spelling or broaden the input shape
  beyond the two fields inspected by the predicate.
- Do not accept browser stores, DOM/Svelte, Fastify, filesystem, process-global,
  credential, persistence, or aggregate database dependencies.

## Handoff

After this leaf closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then continue Phase 3 only
with another independently justified neutral leaf.
