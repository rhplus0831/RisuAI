# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

## Current Best Task

Execute the [memory-embedding configuration seam
slice](phases/slices/phase-4-server-consumer-migration/memory-embedding-configuration-seam.md).

1. Define the complete memory-embedding model vocabulary and the narrow settings
   fields used by Fastify resolution and job execution under the server owner.
2. Replace direct type-only imports of browser `HypaModel` and aggregate
   `Database` in the resolver and job handler; include embedding operations only
   if its input can be narrowed without changing policy.
3. Preserve custom URL normalization, credential selection, provider aliases,
   dimension/input/batch limits, exact local-model rejection, and error strings.
4. Keep SQLite transitions, dispatch, batching, deadlines, masking, and
   persistence unchanged.
5. Refresh the baseline after focused resolver/job/operation and ownership proof.

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
- Module-integration normalization is released at `d314bbdcf`; two browser
  consumers and the Fastify effective-generation consumer share one implementation.
- Prompt-settings vocabulary is released at `96e0dedfb`; browser settings and
  Fastify prompt command consumers share one dependency-free key contract.
- BardWiki's server type seam is released at `44e53527a`; its five production
  consumers no longer import browser aggregate/chat declarations directly.

## Not In This Slice

- Do not move browser-local embedding implementations into Fastify or make them
  remotely executable.
- Do not change embedding provider dispatch, request limits, credentials,
  masking, job state, or persistence.
- Do not widen shared-core with aggregate memory/database application types.

## Handoff

After this slice closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then select the next
domain-sized Phase 4 consumer migration from the refreshed inventory.
