# Next Steps

Date: 2026-05-24

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-4b added the provider-backed summary adapter in
`server/fastify/src/memorySummaryAdapter.ts`. Planned summary prompt
messages can now be sent through non-streaming OpenAI-compatible API
providers via `summarizeOnce(messages, opts)`, which wraps `runOpenAI`
directly and normalizes responses into `{ text, tokens } | { error }`.
OpenAI, NanoGPT, and OpenRouter variant resolution is shared with the
`/completion` route through `server/fastify/src/generation/openaiCompatible.ts`.
Aborted responses normalize to errors, and provider output is scrubbed
with the existing `<Thoughts>` / `<think>` summary cleanup helpers.
This still does not wire the worker, write summaries, embed chunks,
rate-limit batches, or touch browser UI.

## Immediate Pickup

Continue Phase 8 with **8-4c - Summarize job handler**.

Expected scope:

- Wire the `summarize` memory job handler against the planned chunks
  created by 8-3d.
- Load the chunk payload and chunk row, then build the summary prompt
  with `buildHypaV3SummaryPrompt`.
- Call `summarizeOnce(messages, opts)` for the supported API-backed
  summary model path.
- Persist successful output to `memory_summaries`.
- Mark chunks summarized and complete jobs through the 8-2 queue
  primitives.
- Fail jobs with useful errors for missing chunks, missing chat data,
  prompt build errors, provider failures, and invalid summary writes.

Out of scope for 8-4c:

- Embedding jobs or vector persistence.
- Similarity selection and prompt assembly reads from memory summaries.
- Summary rate limiting and ordered batch write behavior; that remains
  8-4d.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Local MLC / ONNX / WebLLM summary runtimes.

Implementation notes:

- `summarizeOnce` currently returns `tokens: 0` because `runOpenAI` does
  not expose upstream usage data yet.
- Keep 8-4c idempotent: if a summary for the target chunk/model already
  exists, the handler should avoid duplicate writes and still converge
  the chunk/job state.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the summarize payload needs tightening.

## Queue After 8-4c

1. 8-4d - Summary rate limiting and ordered writes.
2. 8-5a - Embedding provider contract.

## Parallel Or Deferred

- Normalized-DB cross-assembler parity artifact: useful historical check,
  but no longer blocking Phase 7 closeout.
- Hub-route session auth: browser-loaded hub resources can still 401 on
  password-protected deployments because they cannot send `risu-auth`.
- Ooba OAI-compatible, NovelAI text, and NovelList: wait for server-side
  string flattening.

## Verification

Run the relevant focused tests while implementing, then before closing a
slice run:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

Last recorded full baselines after 8-4b: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 969 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-4b verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySummaryAdapter.test.ts server/fastify/__tests__/memorySummaryPrompt.test.ts --config server/fastify/vitest.config.ts
pnpm check
pnpm test
pnpm api:test
pnpm build
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- 8-1a-i closeout:
  [`../phases-completed/phase-8-memory-8-1a-i.md`](../phases-completed/phase-8-memory-8-1a-i.md)
- 8-1a-ii closeout:
  [`../phases-completed/phase-8-memory-8-1a-ii.md`](../phases-completed/phase-8-memory-8-1a-ii.md)
- 8-1b closeout:
  [`../phases-completed/phase-8-memory-8-1b.md`](../phases-completed/phase-8-memory-8-1b.md)
- 8-1c closeout:
  [`../phases-completed/phase-8-memory-8-1c.md`](../phases-completed/phase-8-memory-8-1c.md)
- 8-2a closeout:
  [`../phases-completed/phase-8-memory-8-2a.md`](../phases-completed/phase-8-memory-8-2a.md)
- 8-2b closeout:
  [`../phases-completed/phase-8-memory-8-2b.md`](../phases-completed/phase-8-memory-8-2b.md)
- 8-2c closeout:
  [`../phases-completed/phase-8-memory-8-2c.md`](../phases-completed/phase-8-memory-8-2c.md)
- 8-2d closeout:
  [`../phases-completed/phase-8-memory-8-2d.md`](../phases-completed/phase-8-memory-8-2d.md)
- 8-2e closeout:
  [`../phases-completed/phase-8-memory-8-2e.md`](../phases-completed/phase-8-memory-8-2e.md)
- 8-3a closeout:
  [`../phases-completed/phase-8-memory-8-3a.md`](../phases-completed/phase-8-memory-8-3a.md)
- 8-3b closeout:
  [`../phases-completed/phase-8-memory-8-3b.md`](../phases-completed/phase-8-memory-8-3b.md)
- 8-3c closeout:
  [`../phases-completed/phase-8-memory-8-3c.md`](../phases-completed/phase-8-memory-8-3c.md)
- 8-3d closeout:
  [`../phases-completed/phase-8-memory-8-3d.md`](../phases-completed/phase-8-memory-8-3d.md)
- 8-4a closeout:
  [`../phases-completed/phase-8-memory-8-4a.md`](../phases-completed/phase-8-memory-8-4a.md)
- 8-4b closeout:
  [`../phases-completed/phase-8-memory-8-4b.md`](../phases-completed/phase-8-memory-8-4b.md)
- Phase 7 closeout:
  [`../phases-completed/phase-7-prompt-assembly-closeout.md`](../phases-completed/phase-7-prompt-assembly-closeout.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Phase 7 archive through 7-12c:
  [`../phases-completed/phase-7-prompt-assembly-through-7-12c.md`](../phases-completed/phase-7-prompt-assembly-through-7-12c.md)
- 7-12d-i closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-i.md`](../phases-completed/phase-7-prompt-assembly-7-12d-i.md)
- 7-12d-ii closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-ii.md`](../phases-completed/phase-7-prompt-assembly-7-12d-ii.md)
- 7-12d-iii-a closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-a.md)
- 7-12d-iii-b closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iii-b.md)
- 7-12d-iv closeout:
  [`../phases-completed/phase-7-prompt-assembly-7-12d-iv.md`](../phases-completed/phase-7-prompt-assembly-7-12d-iv.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
