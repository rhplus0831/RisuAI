# Phase 8: Memory, Embeddings, Jobs, And Workers

Status: Complete on 2026-08-29; Phases 0-3, 6, and 7 satisfied.

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

## Completed Audit Record

Phase 8 opened with 43 category-H owners and 454 cases, including 42
parameterized rows: 20 frontend owners / 127 cases and 23 Fastify owners / 327
cases. Both frozen opening sets passed before remediation. Sixteen regressions
were added inside opening owners, and the exact opening set then passed 132/132
frontend cases and 338/338 Fastify cases.

Seventeen owners / 199 cases were reclassified to B/D/F/G/L after their
complete families were reviewed. The current H set is 26 owners / 270 cases /
14 parameterized rows: 13 frontend owners / 94 cases and 13 Fastify owners /
176 cases. There is no built-browser H owner.

### Memory Lifecycle And Disposition Map

| Lifecycle boundary | Current evidence and protected contract | Disposition |
| --- | --- | --- |
| Prompt planning and memory-window composition | Client/server window, summary prompt, and prompt adapter owners protect model-visible ordering and budget semantics | Reclassify four owners to F; retain their tests unchanged |
| Chunk planning, budget allocation, and repository | Real SQLite chunks, summaries, embeddings, tombstones, job transitions, ranking, selection, retries, and cleanup | Keep; distinct durable authority |
| Provider model/adapters and embedding operations | Exact provider resolution, requests, aborts, grouping, response count/dimension/finite validation | Reclassify nine owners to G; retain their tests unchanged |
| Embed and summarize handlers | Batching, deadlines, cancellation, transactional rollback, idempotency, and partial provider failures | Keep; execution layer distinct from adapters and repository |
| Worker scheduler | Claiming, fairness, retry/backoff, recovery, bounded drain, listener isolation, graceful stop, and retention | Keep; asynchronous coordinator authority |
| Shared stream-job runtime | Registry and routes shared beyond memory | Reclassify two owners to L |
| Memory API and events | Auth/writer policy, enqueue/list/cancel, compact reads, ETag/version, redacted terminal events, and bounded history | Keep memory-specific owners; terminal queries are bounded in SQLite and response |
| Browser refresh and projection | ETag polling, stream/version fences, terminal identity, chat switching, subscriber fanout, and local/server separation | Keep; two stale-snapshot defects and subscriber isolation are fixed |
| Mounted Hypa UI | Owner/reset races, editing/flush failure, job refresh/cancel, accessibility, and visible status | Keep H owners except worker-error presentation, which moves to D |
| Character summary browser protocol | State projection contract rather than memory execution | Reclassify one owner to B |

No owner met the mandatory merge or removal proof. Planner, repository,
handler, worker, route/event, client projection, and mounted UI evidence shares
vocabulary but catches different failure modes.

### Findings And Remediation

- `TSA-P08-001` fixes same-stream stale snapshots and new-stream version
  handoff; `TSA-P08-002` transactionally removes edited transcript-derived,
  unsummarized chunks and their jobs.
- `TSA-P08-003` broadens terminal error redaction; `TSA-P08-004` rejects values
  that overflow only after Float32 conversion; `TSA-P08-005` salvages and
  reports malformed legacy summaries at import and startup.
- `TSA-P08-006` gives embedding caches an unambiguous versioned tuple identity;
  `TSA-P08-007` isolates throwing browser event subscribers.
- `TSA-P08-008` fences delayed cancellation responses by owner epoch and
  concrete instance; `TSA-P08-009` bounds explicit and default terminal
  history at both SQL and response layers.
- `TSA-P08-010` records all 17 B/D/F/G/L routing corrections, and
  `TSA-P08-011` records why retained lifecycle layers are distinct.

`TSA-P08-012` bounds the missing live browser job journey, smoke's disabled
memory worker, real-provider/recorded embedding and summary contracts,
summarized-memory invalidation policy after transcript edits, restart with a
real in-flight provider, and historical compatibility. Phase 12 owns worker
and query observability, Phase 13 owns the browser composition and explicit
summarized-memory product decision, and Phase 14 owns the final residual and
compatibility verdict.

### Validation Summary

The complete ordinary frontend universe passed 6,719/6,719; the two isolated
performance owners passed 6/6. Complete Fastify passed 3,341 cases with one
intentional direct-only Realm scale skip. The exact reviewed opening set passed
470/470 cases after remediation. Focused repository/route checks also passed
after terminal SQL limiting landed.

Client and server typechecks, affected selection, linked inventories,
formatting, and diff checks passed. The production smoke build passed with the
existing allowed diagnostics and all 35/35 Chromium journeys passed; because
the smoke fixture disables the memory worker and no H browser owner exists,
this is not represented as an end-to-end memory lifecycle claim.

Fresh lists and measured results record 700 live owners and 10,102 cases with
one direct-only skip and 1,294 parameterized rows. Live decisions are 483 Keep,
58 Reclassify, and 159 Pending. No compatibility fixture or golden changed.
