# Phase 4: Durable Jobs and Explicit Confirmation

Status: in progress (slices 1-2 of 5 complete).

Goal: add restart-safe BardWiki background execution and explicit confirmation
that creates one atomic event document per exact confirmed source version.

## Depends On

- Phase 3 committed-document retrieval is stable.
- Phase 0 job/receipt/model-output contracts remain current.

## Scope

- Generalize or adapt the existing memory worker repository/runner so Hypa and
  BardWiki execute in separate filtered lanes.
- Add BardWiki job kinds, payload validators, claiming, retry/backoff,
  cancellation, retention, restart recovery, and sanitized status events.
- Keep existing Hypa job routes and handlers behaviorally compatible.
- Add the revisioned explicit `Confirm to BardWiki` command with active message
  id/hash preconditions.
- Insert/reuse the turn receipt and pending job atomically.
- Resolve the effective memory model profile at execution time and use existing
  provider deadline, abort, masking, and request-history boundaries.
- Implement the first strict analysis schema and bounded repair behavior.
- Stage one event document and commit it, its version/source/link/search state,
  applied receipt/change manifest, revision, and command event atomically.
- Add job/receipt status to the chat workspace with retry/cancel controls and
  clear terminal error presentation.
- Handle every crash point idempotently, especially commit-before-job-complete.

## Out of Scope

- Automatic confirmation from send finalization.
- Model-authored canonical document changes.
- Historical rebuild.

## Anchors

- `server/fastify/src/memoryRepository.ts`
- `server/fastify/src/memoryWorker.ts`
- `server/fastify/src/memoryEvents.ts`
- `server/fastify/src/routes/memoryJobs.ts`
- `server/fastify/src/memorySummarizeJobHandler.ts`
- `server/fastify/src/memorySummaryModel.ts`
- `server/fastify/src/app.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/requestHistory.ts`
- `src/ts/server/memoryJobProjection.svelte.ts`
- `src/lib/Others/HypaV3Modal/server-memory-jobs.svelte`

## Implementation Slices

1. Reusable worker lane/filter/recovery mechanics with Hypa parity tests.
2. BardWiki job schema, repository, route/event observation, and no-op handler.
3. Explicit confirmation command and receipt/job idempotency.
4. Event-analysis model adapter, strict validation, atomic commit, and crash
   recovery.
5. Workspace status, retry/cancel, and error UX.

## Invariants

- Explicit confirmation is accepted at most once per exact source hash pair.
- A queued browser intent is not presented as server confirmation.
- Job payloads contain no credentials or whole transcript copies.
- A worker always rereads source messages and settings before provider work.
- Source mismatch before or after the model call prevents document writes.
- Invalid model output produces no partial event document.
- Process restart and retry preserve exactly-once event identity.
- Cancelling one BardWiki job aborts only that job.
- Long BardWiki calls do not block Hypa job claims or chat generation.
- Live memory/job events are presentation aids; the initial targeted read is the
  status authority.

## Required Coverage

- Job kind/payload validation and public Hypa-route fencing.
- Fair lane progress with one blocked/slow BardWiki handler and pending Hypa
  work.
- Restart recovery, retry exhaustion, cancellation, retention, wake/poll, and
  event sanitization.
- Explicit confirmation success, stale id/hash, non-assistant target, disabled
  message, duplicate/replayed command, and concurrent confirmation.
- Model success, timeout, abort, malformed schema, repair success/failure, and
  unavailable profile/credentials.
- Crash before provider, after provider, during commit, after commit, and before
  operational completion.
- Event document provenance and prompt retrieval after commit.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/memoryRepository.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts \
  server/fastify/__tests__/memoryEvents.test.ts \
  server/fastify/__tests__/memoryJobsRoutes.test.ts \
  server/fastify/__tests__/memorySummarizeJobHandler.test.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run \
  src/ts/server/memoryJobProjection.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add focused BardWiki receipt, handler, job-route, crash-replay, and UI status
tests. The exact list belongs in the phase completion note.

## Exit Criteria

- Explicit confirmation reliably creates one event document or a visible
  retryable/terminal failure.
- Worker restart/crash/replay cannot duplicate the event.
- Hypa progress and behavior remain proven under concurrent BardWiki work.
- Canonical document bodies are still changed only by manual commands.

## Risks

- Running two unfiltered workers over one table can double-claim or recover each
  other's jobs. Filtering must exist in claim and startup recovery paths.
- Extending the public memory-job create route would allow arbitrary expensive
  work; BardWiki jobs must originate from dedicated validated commands.
- Writing the event document before completing analysis validation would repeat
  RisuBard's partial-write weakness.

## Completion Notes

### 2026-08-29: slices 1-2 — isolated jobs and operational observation

- Preserved the existing `memory_jobs`/`MemoryWorker` Hypa ownership boundary
  and adapted its mechanics into a second `bardwiki_jobs`/`BardWikiWorker`
  lane. The separate tables make claim, startup recovery, retention, wake,
  abort maps, timers, and single-provider-call ownership structurally unable
  to cross lanes.
- Added strict identifier-only payload validators for all three locked job
  kinds, including exact field sets, source-hash validation, identity fences,
  bounded retry metadata, and the 16 KiB persisted-payload ceiling.
- Added atomic due claims, per-chat round-robin scheduling, legal terminal
  transitions, bounded exponential retry, explicit failed-job retry with a new
  instance id, cancellation, startup recovery, and terminal retention.
- Added authenticated active-writer retry/cancel routes without a public
  BardWiki enqueue endpoint. Hypa's public route remains fenced to
  `chunk|embed|summarize`.
- Added secret-free `bardwiki.job` status events. Payloads, hashes, prompts,
  provider output, and credentials are absent from the route and event
  projections.
- Focused BardWiki repository/worker/routes passed 10 tests; Hypa route and
  protection compatibility passed 26 tests; the pre-existing 23-test Hypa
  worker suite passed independently; `pnpm run check:server` passed.
