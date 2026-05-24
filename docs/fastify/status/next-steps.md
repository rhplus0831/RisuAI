# Next Steps

Date: 2026-05-25

Use this file as the day-to-day pickup runbook. Completed slice tables
were moved to [`../phases-completed/`](../phases-completed/).

Policy note: there are no actual Fastify users yet, so this process does
not need compatibility migrations. Update the current schema and import
paths directly instead of preserving old intermediate Fastify shapes.

## Last Done

8-4d added the summarize batch path. Fastify startup now wires a
summarize batch handler by default while preserving explicit summarize
handler overrides. The batch handler applies
`summarizationMaxConcurrent`, spaces provider calls with
`summarizationRequestsPerMinute`, stages successful provider results, and
commits summaries in planned order only until the first failure,
cancelled job, or invalid/empty write. Later staged successes are left
uncommitted and returned to the existing retry/fail queue handoff.

## Immediate Pickup

Continue Phase 8 with **8-5a - Embedding provider contract**.

Expected scope:

- Define the server-side embedding provider contract and typed result
  shape.
- Resolve embedding model ids and credentials for API-backed
  OpenAI-compatible embeddings and custom embedding endpoints.
- Normalize provider responses into vectors with dimension validation and
  useful typed errors.
- Keep browser-local transformers, WebGPU, WebLLM, MLC, and ONNX out of
  server scope.
- Add focused unit tests for credential lookup, request construction,
  response normalization, dimension mismatch, and provider error
  handling.

Out of scope for 8-5a:

- Embed job handler wiring and vector persistence.
- Voyage contextual embedding grouping.
- Similarity ranking and memory budget allocation.
- Prompt assembly reads from memory summaries or embeddings.
- Browser progress UI, browser listeners, and browser list/cancel
  controls.
- Browser-local embedding runtimes.

Implementation notes:

- Mirror the 8-4 summary adapter shape where practical, but keep the
  contract embedding-specific: vector dimensions and provider model ids
  matter more than token usage.
- The schema already has `memory_embeddings`; 8-5a should not write it.
- Preserve the no-compatibility-migrations policy: update current
  Fastify shapes directly if the contract needs a tighter shape.

## Queue After 8-4d

1. 8-5b - Embed job handler + vector persistence.

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

Last recorded full baselines after 8-4d: `pnpm check` clean,
`pnpm test` 639 tests plus 4 skipped, `pnpm api:test` 980 tests, and
`pnpm build` passing with existing CSS `::highlight`, browser
externalization, plugin-timing, and chunk-size warnings.

Focused 8-4d verification:

```bash
pnpm exec vitest run server/fastify/__tests__/memorySummarizeJobHandler.test.ts server/fastify/__tests__/memoryWorker.test.ts --config server/fastify/vitest.config.ts
```

## References

- Active phase: [`../phases/phase-8-memory.md`](../phases/phase-8-memory.md)
- Latest closeout:
  [`../phases-completed/phase-8-memory-8-4d.md`](../phases-completed/phase-8-memory-8-4d.md)
- Completed closeout index:
  [`../phases-completed/README.md`](../phases-completed/README.md)
- Phase 7 final summary:
  [`../phases/phase-7-prompt-assembly.md`](../phases/phase-7-prompt-assembly.md)
- Server status: [`server.md`](server.md)
- sendChat status: [`sendchat.md`](sendchat.md)
