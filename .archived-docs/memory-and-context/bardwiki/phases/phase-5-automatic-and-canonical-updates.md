# Phase 5: Automatic Confirmation and Canonical Updates

Status: complete.

Goal: attach durable prior-turn confirmation to successful sends and safely
maintain canonical wiki documents through validated, atomic model-authored
section changes.

## Depends On

- Phase 4 explicit event jobs and worker crash semantics are proven.

## Scope

- Add automatic prior-turn receipt/job insertion to the authoritative successful
  `send` finalization transaction.
- Resolve the accepted user row from operation lineage and identify the exact
  preceding active assistant/user source pair under the Phase 0 algorithm.
- Preserve current assistant candidate behavior; add no automatic receipt for
  continue or regenerate.
- Ensure inline generation, durable generation, retries, replay, cancellation
  partials, and finalization recovery converge on the same scheduling path.
- Add canonical compiler model output that targets stable document ids and
  bounded H3 section operations with expected base hashes.
- Stage analysis event plus canonical changes before any domain write.
- Validate the whole change set and commit all event/canonical documents,
  versions, sources, links/search, receipt manifest, revision, and event in one
  transaction.
- Add conflict retry using a fresh document snapshot.
- Detect transcript edits/deletes/truncations/alternate replacements that affect
  pending or applied receipts.
- Cancel/obsolete pending jobs and implement safe applied-receipt reconciliation
  or `needs_review` escalation.
- Add per-chat automatic/manual policy controls and user-visible review state.

## Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/routes/generationOperations.ts`
- `server/fastify/src/generationOperations.ts`
- `server/fastify/src/generationEffects.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/src/memoryInvalidation.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/commands/events.ts`
- BardWiki repository/worker/model modules from Phases 1 and 4.

## Confirmation Matrix to Prove

| Operation | Automatic source | Expected result |
| --- | --- | --- |
| First successful send | None | New assistant remains a candidate. |
| Later successful send | Previous accepted user/assistant turn | One receipt/job, atomic with finalization. |
| Continue | None | Current assistant remains unconfirmed. |
| Regenerate | None | Candidate/alternates change; no receipt. |
| Retry/replay same send | Same previous source | Existing receipt reused; no duplicate job. |
| Failed/cancelled send before finalization | None | No confirmation side effect. |
| Explicit confirm current assistant | Current active source | Existing Phase 4 command behavior. |

## Canonical Patch Contract

- A patch names a stable document id or requests a bounded new document with a
  validated kind/title/path proposal.
- Existing document operations carry the base content hash/version used by the
  model.
- Operations are limited to named H3 sections or the exact structured granularity
  locked in Phase 0; unrestricted whole-corpus replacement is rejected.
- Every proposed document is validated for path, type, size, links, aliases, and
  forbidden metadata before commit.
- Either the full turn change set commits or none of it does.
- Manual changes made after snapshot force retry or review; they are not
  overwritten.

## Invariants

- Generation finalization stays authoritative; no SSE/browser consumer schedules
  automatic memory.
- Automatic job insertion cannot make an otherwise failed generation commit.
- The current generated assistant is never accidentally ingested by its own
  send finalization.
- One exact source version produces at most one applied change set.
- Provider work occurs outside the finalization and document transactions.
- Event and canonical updates for one receipt are atomic.
- Reconciliation cannot erase unrelated later/manual changes.
- Any ambiguous inverse becomes visible `needs_review`, not silent data loss.
- Disabling automatic updates stops new automatic receipts without hiding or
  deleting existing committed documents.

## Required Coverage

- Every confirmation-matrix row across inline and durable generation.
- Generation finalization retry journal and command/event replay.
- Multi-choice/reroll alternates and active-candidate replacement.
- Canonical create/update/multi-document transaction success and validation
  failure rollback.
- Concurrent manual edit conflict and fresh-snapshot retry.
- Source edit/delete/truncate before claim, during provider call, after apply,
  and after later manual wiki edits.
- Safe inverse versus `needs_review` behavior.
- Disabled automatic mode and explicit confirmation coexistence.
- Prompt retrieval sees only the last committed complete change set.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/commands.test.ts \
  server/fastify/__tests__/memoryWorker.test.ts \
  server/fastify/__tests__/assemble.test.ts
pnpm exec vitest run \
  src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add focused automatic-confirmation, canonical-handler, source-invalidation, and
reconciliation suites. Record the exact crash/conflict matrix in the completion
note.

## Exit Criteria

- Successful sends schedule only the intended prior turn and do so durably.
- Canonical updates are bounded, validated, atomic, versioned, and provenance
  backed.
- Source mutations lead to cancellation, safe reconciliation, or visible review
  without silent stale canon.
- All generation modes and replay/recovery paths have focused proof.

## Risks

- Attaching to the wrong generation boundary can ingest unaccepted candidates.
- A second model pass increases latency and cost in the background lane; expose
  status and keep provider deadlines/bounds strict.
- Fine-grained automatic rollback is unsafe after manual edits. Prefer explicit
  review over aggressive inversion.

## Completion Note

Completed on 2026-08-29 in five reviewable commits:

- `9b195797a` schedules/reuses the exact preceding source tuple inside successful
  inline, durable, and replayable finalization; first-send, continue,
  regenerate, failure, and cancellation paths remain side-effect free.
- `8c9ffccc8` adds strict JSON canonical compilation with at most 32 create or
  named-H3 operations, complete preflight staging, version/hash fences, one
  validation repair, one fresh-snapshot conflict recompilation, and one atomic
  event/canonical revision/event commit.
- `9ee87b48f` detects source edits/deletes/truncations/replacements at the
  authoritative message boundary, cancels pending work, and either safely
  inverts an unchanged manifest or marks affected live documents and the
  receipt `needs_review` without changing Markdown.
- `a3f549038` enables global and inherited per-chat automatic/canonical policy
  controls and makes review state visible in the workspace.
- `4ed6744b9` emits the queued job observation and wakes the isolated BardWiki
  worker only after the generation transaction commits, including finalization
  retry recovery.

Crash/conflict proof: before-provider and provider failures leave no document
rows; source mutation during provider work cancels the running job and prevents
commit; a throw before commit rolls back the entire event/canonical set; a
post-commit operational failure replays to the existing receipt/change-set
identity; malformed output receives one repair and then fails atomically;
concurrent canonical edits receive one fresh-snapshot compilation; later manual
edits make inverse reconciliation visibly require review.

Validation passed 10 server files/608 tests and 5 client files/317 tests, plus
client-library declarations, all server-facing typechecks, and zero Svelte
diagnostics.
