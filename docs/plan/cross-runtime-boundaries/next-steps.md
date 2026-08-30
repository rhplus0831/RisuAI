# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

## Current Best Task

Execute the [memory-summary message seam
slice](phases/slices/phase-4-server-consumer-migration/memory-summary-message-seam.md).

1. Define one Fastify-owned message record with exactly the role, content, memo,
   name, thoughts, and multimodal metadata used by memory summarization.
2. Replace the four direct type-only browser `OpenAIChat` imports in the memory
   planner, chunk planner, summary prompt, and summary adapter.
3. Preserve example/NewChat/empty-row skip rules, summarized-prefix detection,
   token accounting, ChatML parsing, thought scrubbing, chunk hashes, and job
   payload identity.
4. Keep provider dispatch, model-profile resolution, SQLite job state, batching,
   deadlines, retries, and persistence unchanged.
5. Refresh the baseline after focused planner/prompt/adapter/job and ownership
   proof.

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
- Memory-embedding resolution and job configuration are released at
  `3a96d8505`; their Fastify-owned inputs removed five production and one test
  browser-model edges.
- Provider conversion inputs are released at `e0be7d72e`; provider-wire builders
  no longer depend on the browser prompt-row declaration.

## Not In This Slice

- Do not change model-profile resolution, provider requests, job persistence,
  retries, or memory-summary scheduling.
- Do not broaden the record into an aggregate browser prompt or database type.
- Do not migrate the separate memory-summary configuration/database seam in this
  slice.

## Handoff

After this slice closes, update [`status.md`](status.md) and
[`latest-verification.md`](latest-verification.md), then select the next
domain-sized Phase 4 consumer migration from the refreshed inventory.
