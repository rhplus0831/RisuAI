# Phase 8: Memory, Embeddings, Jobs, And Workers

Status: Pending; depends on Phases 0-3 and Phase 6 prompt boundaries.

## Objective

Audit whether memory tests protect planning, indexing, summaries, embeddings,
selection, job state, worker lifecycle, and browser reconciliation against
partial failure and permanent-stall defects.

## Scope

- Legacy/current memory import, repositories, chunk planning, budget allocation,
  summary prompts/models/adapters, and prompt-memory integration.
- Embedding model/adapters, cache keys, operations, similarity ranking,
  selection, and malformed/mixed vector behavior.
- Embed/summarize handlers, routes/events, worker fairness, retries,
  cancellation, shutdown, restart, and terminal state.
- Browser job events, terminal fences, memory modal/UI reset and stale-owner
  behavior.

Primary discovery guide:
[`memory-and-embeddings.md`](../../../tests/memory-and-embeddings.md).

## Audit Questions

- Are repository and job transitions asserted through exact durable state and
  events, not only mocked handler returns?
- Do tests cover malformed, empty, mixed-dimension, stale, duplicate, and
  partially written embedding/summary data?
- Can cancellation, retry, fairness, shutdown, or restart leave jobs permanently
  active or indexes corrupt?
- Are ranking assertions semantically meaningful and sensitive to plausible
  similarity defects?
- Does browser UI reconcile terminal/stale work visibly, and are reset races
  bound to stable chat/memory owners?

## Required Outputs

- Memory lifecycle map from prompt planning through repository/jobs/workers/UI.
- Findings for weak vector/ranking matrices, mocked state transitions, missing
  partial-failure proof, race timing, stale owners, and duplicate planner tests.
- Intentional overlap notes for adapter/unit/repository/route/browser layers.
- Replacement proof for every retired legacy-memory or UI scenario.

## Exit Criteria

- Every Phase 8 test has a disposition and named memory/job contract.
- Unique repository, ranking, retry, cancel, shutdown, restart, and UI terminal
  behavior remains protected.
- Critical/High corruption or permanent-active findings are resolved or gated.
- Removed legacy cases have explicit compatibility ownership decisions.
- Count deltas and residual malformed-data/browser gaps are recorded.

## Validation

- Focused client memory, browser bridge/UI, and Fastify memory tests
- `pnpm test:affected --dry-run` and selected lanes
- `pnpm test:frontend:all`
- `pnpm test:server`
- Relevant browser smoke if visible/reload job behavior changes
- Isolated memory/load-cost gates where affected
- `pnpm format:check`
- `git diff --check`
