# Cross-Runtime Boundaries Next Steps

Date: 2026-08-31

## Current Best Task

Execute the [MCP identifier ownership
slice](phases/slices/phase-4-server-consumer-migration/mcp-identifier-ownership.md).

1. Move the dependency-free MCP importability predicate to a dedicated
   `@risuai/shared-core` subpath.
2. Point the browser import flow and Fastify module command validator at that
   owner without widening accepted identifiers.
3. Preserve HTTPS, loopback HTTP, and non-whitespace `internal:`, `stdio:`, and
   `plugin:` syntax exactly; do not move DNS, OAuth, or runtime egress policy.
4. Add behavior and closed ownership proof, refresh the architecture baseline,
   and run the focused module and Phase 10 suites plus both type gates.

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

## Not In This Slice

- Do not change module activation, module persistence, MCP execution, OAuth,
  credential handling, or egress validation.
- Do not fold identifier importability into Fastify's network authorization
  policy; the predicate is shared input syntax only.

## Handoff

After this slice closes, relocate the two neutral test-fixture families from the
browser tree, then select the next production Phase 4 consumer migration from
the refreshed inventory.
