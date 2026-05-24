# Phase 8 Memory - 8-4a Closeout

Date: 2026-05-24

## Scope Landed

- Added `server/fastify/src/memorySummaryPrompt.ts` as the pure Hypa V3
  summary prompt builder for planned chunks.
- Ported default summarize and re-summarize prompt fallback behavior
  from the browser path.
- Added `{{slot}}` replacement for custom prompts and a provider-neutral
  `OpenAIChat[]` output shape for the 8-4b adapter.
- Added ChatML parsing fallback for summary prompts, including separator
  and newline role forms.
- Added pure `<Thoughts>` and `<think>` summary output scrubbers for
  later persistence.
- Routed planned chunk text sanitization through the shared summary
  sanitizer so inlay tokens become `[Image]`, with normalized line
  endings and trimmed message content.

## Boundaries

- No provider calls landed.
- No summary adapter, worker handler, job transitions, summary rows,
  embeddings, memory prompt selection, browser listeners, or browser
  controls landed.
- The memory worker still uses no-op handlers for `summarize`; 8-4c is
  where planned jobs become executable summary work.

## Verification

Passed:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySummaryPrompt.test.ts --config server/fastify/vitest.config.ts
pnpm exec vitest run server/fastify/__tests__/memoryChunkPlanner.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Focused summary prompt verification passed with 7 tests. Focused chunk
planner verification passed with 5 tests. `pnpm check` was clean.
`pnpm test` passed with 639 tests plus 4 skipped. `pnpm api:test`
passed with 962 tests. `pnpm build` passed with existing CSS
`::highlight`, browser externalization, plugin-timing, and chunk-size
warnings.

## Next Pickup

Continue with 8-4b - Provider-backed summary adapter. Add the
server-side non-streaming summary provider adapter around `runOpenAI`,
normalizing its response into `{ text, tokens } | { error }` for the
future summarize job handler. Keep worker wiring, summary persistence,
embedding, rate limiting, local browser runtimes, and browser UI out of
scope for 8-4b.
