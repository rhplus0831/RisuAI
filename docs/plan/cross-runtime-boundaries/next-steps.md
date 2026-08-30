# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

## Current Best Task

Execute the [prompt-info snapshot ownership
slice](phases/slices/phase-4-server-consumer-migration/prompt-info-snapshot-ownership.md).

1. Replace aggregate database/message types with narrow structural input and
   output records in a dependency-free shared leaf.
2. Retain the browser facade; point Fastify effective generation directly at
   the shared owner.
3. Preserve disabled output, preset-name coercion, select/text/boolean
   formatting, row ordering, and missing-value behavior.
4. Do not move prompt-template selection, chat state, persistence, or generation
   policy.

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
- Memory-summary messages are released at `856834205`; four production and four
  test consumers use a Fastify-owned record.
- Prompt-row rendering/budget is released at `6adc180fe` with prompt-summary
  reuse at `701bc555f`; six production and five test imports were removed.
- Chat-variable defaults are released at `43c0ac781`; their parser no longer
  imports aggregate browser database/character declarations.
- Trigger transcript caching is released at `68883eba5`; the request-local
  WeakMap cache now accepts Fastify-owned message/chat inputs.
- Prompt-template cards are released at `ee87bc6ac`; four production and three
  test imports now use a closed Fastify-owned union.
- Prompt-message value ownership is complete at `d31f0eb16` with the
  assembly/dispatch/route follow-up at `53e9fa0c3`; fourteen production and four
  test browser-model imports were removed.
- Prompt-memory query inputs are released at `e520f5bb7`; query construction now
  consumes Fastify-owned transcript projections and embedding settings.
- Trigger compatibility is released at `68d41f2cd` with source-level browser
  warning parity at `75b0f6278`; four runtime/mixed edges were removed.
- Generation-finalization retry messages are released at `79041383f`; retained
  JSON now uses a narrow Fastify-owned structural envelope.
- Trigger descriptors are released at `5431a9921`; six Fastify production/test
  consumers use a closed server-owned descriptor mirror with AST parity proof.
- Module descriptors are released at `ba09370c0`; eight Fastify production/test
  consumers use a closed server-owned module projection with AST parity proof.
- Bounded-regex settings are released at `9bcffa62e`; Fastify accepts only the
  five compatibility, timeout, and output-bound fields it reads.
- MCP identifier validation is released at `12076cc52`; browser and Fastify
  consumers use the eighteenth audited shared-core leaf.
- The large deterministic corpus and Phase 9 CBS fixtures are released at
  `e75d742b6` under the neutral `test/fixtures` owner.
- Mutation certificates, key/value parsing, default hotkeys, and default prompt
  settings are released through four audited shared-core subpaths.
- The Hypa truncation confirmation code is released through
  `@risuai/protocol/hypa-context-truncation` at `d82d1b86b`.
- RisuChat parser helpers are released through
  `@risuai/shared-core/risuchat-parser-helpers` at `574eacd3c`.
- Fastify owns its request-local chat-variable backend at `e823b18f7`; browser
  state remains browser-owned.
- Deterministic calculation is released through
  `@risuai/shared-core/calculation` at `645f562a3`, with runtime-specific
  variable resolvers injected by each host.
- Settings group/projection vocabulary is released through
  `@risuai/shared-core/settings-groups` at `a0f8931c5`.
- Provider-secret masking, Agent/Agent Preset records, memory-model capability,
  and toggle-preset records are released through four audited shared-core
  subpaths.
- RisuChat conditionals accept a host variable resolver at `5e7233e2a`, so
  Fastify parsing uses request-local state without mutating browser backend
  registration.
- Workstream 2 translation cache and NovelList locale identity resolve the
  effective translate profile at `f610c11a1`.

## Holds

- Prompt-template and model-configuration boundaries remain Workstream
  2-dependent.
- Do not move CBS registration state, request-local prompt scope, browser
  application state, parser budgets, or matcher dispatch into shared core.
- Do not remove either consuming TypeScript project reference while approved
  runtime or type-only edges remain.

## Handoff

After this slice closes, take the narrow parser character-argument type seam or
the independently owned browser-smoke fixtures, then refresh the remaining
model/prompt/parser/aggregate-domain ranking.
