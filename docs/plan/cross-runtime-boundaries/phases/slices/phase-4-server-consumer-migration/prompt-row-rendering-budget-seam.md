# Prompt-Row Rendering And Budget Seam

Status: complete through `701bc555f`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: memory-summary message ownership at `856834205`.

## Objective

Give Fastify history, memory, budget finalization, preflight, and template
rendering one server-owned prompt-message contract instead of five direct
browser prompt-model imports.

## Source And Destination

- Sources: `prompt/history.ts`, `prompt/memory.ts`,
  `prompt/budgetFinalize.ts`, `prompt/preflight.ts`, and `prompt/templates.ts`,
  plus their five focused server fixtures.
- Destination: a Fastify-owned prompt message and multimodal record containing
  only row data observed by server prompt/token consumers.
- Delivered delta: six production and five server-test type-only
  browser-application-model edges.

## Behavior Contract

- Preserve role mapping, row order, UUID/memo fallback, disabled/all-before
  filtering, thoughts, inlays, asset prompts, and multimodal dimensions.
- Preserve memory IDs, `lastMemory`, memory-card promotion, and multimodal-only
  rows.
- Preserve independent re-tokenization, overflow removal eligibility, selected
  tokenizer routing, preflight token ranges, memory/cache flags, and no-mutation
  behavior.
- Preserve template empty-row filtering, multimodal-only rows, compatible system
  coalescing, slot order, and prompt-info output.
- Do not change model/profile resolution, prompt database inputs, provider
  dispatch, persistence, revisions, receipts, or events.

## Validation

Run the five focused owner suites and add a closed ownership assertion for all
production consumers. Run both typechecks, architecture inventory, formatting,
and diff checks.

## Done When

- All ten consumers use the Fastify-owned prompt-row contract.
- The baseline accounts for ten removed edges without a new exception.
- Prompt rows, token budgets, templates, and provider-visible output remain
  unchanged.
