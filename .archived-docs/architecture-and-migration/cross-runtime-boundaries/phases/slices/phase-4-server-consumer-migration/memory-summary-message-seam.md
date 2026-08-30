# Memory-Summary Message Seam

Status: complete at `856834205`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: memory-embedding configuration at `3a96d8505` and the
provider-message input seam at `e0be7d72e`.

## Objective

Remove four memory-summary production modules' direct type-only imports of the
browser `OpenAIChat` declaration by giving the Fastify domain one narrow message
record.

## Source And Destination

- Sources: `memoryPlanner.ts`, `memoryChunkPlanner.ts`,
  `memorySummaryPrompt.ts`, and `memorySummaryAdapter.ts`.
- Destination: a Fastify-owned role/content/memo/name/thoughts/multimodal input
  contract shared only by server memory-summary consumers.
- Delivered delta: four production and four server-test type-only
  browser-application-model edges.

## Behavior Contract

- Preserve example, NewChat, empty-row, and disabled-row filtering.
- Preserve summarized-prefix detection, token accounting including names,
  thoughts, and multimodal dimensions, and exact chunk text/hash/payload IDs.
- Preserve inlay replacement, newline normalization, trimming, ChatML parsing,
  parsed thought arrays, and thought-scrubbing errors.
- Do not change model/profile resolution, provider requests, job transitions,
  batching, deadlines, retries, or persistence.

## Validation

Run the focused memory planner, chunk planner, summary prompt, summary adapter,
and summarize-job fixtures. Add a closed ownership assertion for all four
production consumers, then run both typechecks, the architecture gate,
formatting, and diff checks.

## Done When

- All four production consumers use the Fastify-owned record.
- The baseline accounts for four removed edges without a new exception.
- Planning, prompt serialization, provider payloads, and job state remain
  unchanged.
