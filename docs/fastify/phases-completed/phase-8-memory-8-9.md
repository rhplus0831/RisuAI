# Phase 8 Memory - 8-9 Closeout

Date: 2026-05-25

Phase 8 is closed. The final pass verified that server-backed Hypa V3
memory has storage, planning, async summarize/embed jobs, prompt
selection, browser read/progress surfaces, and live chunk planning wired
behind the Fastify path.

## Confirmed

- The `hypav3-memory` fixture remains pinned through the server-backed
  send path, including prompt memory rows, Hypa V3 progress side effects,
  memory job list/cancel envelopes, and missing-memory follow-up
  diagnostics.
- A server-backed chat with no memory rows can cross the configured Hypa
  V3 window, create deterministic `memory_chunks`, and enqueue
  idempotent `summarize` jobs from prompt assembly. Prompt rendering
  remains non-blocking, and no summary or embedding provider calls run in
  the prompt request hot path.
- API coverage includes memory repositories, chunk planning, queue
  retry/cancel behavior, memory job routes, chunk/summary read routes,
  summarize job handling, embedding job handling, provider adapters,
  similarity ranking, budget allocation, prompt-memory selection, and
  legacy Hypa V3 import.
- Imported legacy `hypaV3Data` loads into `memory_summaries` during the
  server import/backfill path.
- Supported server memory provider paths are documented and bounded:
  summary generation uses `subModel` when it resolves to an API-backed
  OpenAI-compatible provider, standard embeddings use OpenAI-compatible
  `ada`, `openai3small`, `openai3large`, or `custom` endpoints, and
  contextual embeddings use `voyageContext3`.
- Browser-local memory runtimes, browser-local summary runtimes, bulk
  re-summary, and per-summary metadata edits remain unsupported in
  server-backed mode by design.
- The `chunk` queue kind remains reserved/no-op. Live chunk planning is
  driven from prompt assembly context; executable worker jobs are
  `summarize` and `embed`.

## Verification

Passed:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Results:

- `pnpm check` - clean, with 0 Svelte errors and 0 warnings.
- `pnpm test` - 652 tests passed, 4 skipped.
- `pnpm api:test` - 1050 tests passed.
- `pnpm build` - passed with the existing CSS `::highlight`, browser
  externalization, plugin-timing, and chunk-size warnings.

## Next Pickup

Start Phase 9 at **9-0 - Mutation inventory and command map**. Keep this
first Phase 9 slice as a planning gate: inventory direct durable browser
mutations, classify command families, lock endpoint and payload shapes,
and avoid command implementation until the map is complete.
