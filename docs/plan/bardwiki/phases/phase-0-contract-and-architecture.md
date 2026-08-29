# Phase 0: Contract and Architecture

Status: pending. Contract work only; do not add production tables, routes,
workers, prompt rows, or visible UI in this phase.

Goal: remove ambiguity from the BardWiki data, confirmation, job, resource,
prompt, and lifecycle contracts before implementation begins.

## Depends On

- The decisions and invariants in [`../PLAN.md`](../PLAN.md).
- Current Fastify architecture and the previously completed RisuBard behavior
  inspection.

## Scope

- Freeze shared names and TypeScript shapes for:
  - Global defaults and per-chat overrides.
  - Document kinds, context policies, aliases, review states, and logical paths.
  - Document versions, source references, link edges, and turn receipts.
  - Confirmation modes and receipt/job state machines.
  - Retrieval configuration, result rows, and diagnostics.
- Freeze route shapes, auth/active-writer behavior, request limits, error codes,
  command events, resource keys, and invalidation targets.
- Specify exact automatic source selection for send, continue, regenerate,
  explicit confirmation, replay, cancellation, partial generation, and provider
  failure.
- Specify edit/delete/truncate/alternate-replacement staleness behavior.
- Specify chat delete, fork, import, export, restore, and rebuild policies.
- Decide whether the initial search implementation is bounded lexical scanning
  or FTS5, while retaining one selector interface.
- Decide the job-table evolution and separate-lane mechanism without renaming or
  migrating unrelated operational state unnecessarily.
- Define the model-output schemas and bounded repair policy for later event and
  canonical update jobs.
- Define size/count/token limits for documents, versions, imports, model output,
  links, and job payloads.
- Define rollout flags and defaults, including the exact behavior of existing
  chats when BardWiki is enabled globally.

## Required Contract Decisions

### Settings inheritance

- Exact global keys in the `memory` settings group.
- Exact per-chat override representation and precedence.
- Whether `enabled` is explicit per chat or inherits a global default.
- Hypa/BardWiki/Hybrid mode and token partition semantics.
- Memory model-profile and prompt-preset references; secrets are never copied.

### Confirmation algorithm

- For a successful `send`, locate the accepted user row by operation lineage,
  then select the immediately preceding active assistant and its preceding user
  source row under disabled/`allBefore` rules.
- The newly persisted assistant is not the automatic source.
- `continue` and `regenerate` create no automatic receipt.
- Explicit confirmation requires active assistant id/hash preconditions.
- Duplicate confirmation returns the existing receipt rather than a second job.
- Define whether a failed later send confirms nothing; the default contract is
  no confirmation until the send finalization transaction commits.

### Domain versus operational writes

- Document/settings/confirmation intent and applied receipt state are revisioned
  domain records.
- Pending/running/retry/cancel job transitions are operational records.
- Automatic receipt/job insertion joins the existing generation finalization
  transaction without a second revision.
- A worker document commit bumps one revision and persists one replayable event.

### Conflict and recovery semantics

- Model calls operate against captured source and document hashes.
- Any source mismatch obsoletes the attempt without document writes.
- Any document mismatch retries against a fresh snapshot or fails with a stable
  conflict reason.
- Applied stale receipts may auto-invert only when every document matches the
  recorded after-hash; otherwise they become `needs_review`.
- Post-commit job replay recognizes the applied receipt/change-set identity.

## Anchors

- `packages/protocol/`
- `src/ts/storage/database.svelte.ts`
- `src/ts/server/settingsGroups.ts`
- `src/ts/server/resourceManifest.ts`
- `src/ts/server/resourceInvalidation.ts`
- `server/fastify/src/db.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/routes/commands.ts`
- `server/fastify/src/routeManifest.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/generationEffects.ts`
- `server/fastify/src/memoryRepository.ts`
- `server/fastify/src/memoryWorker.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/prompt/memory.ts`

## Deliverables

- Final shared type sketches and stable enum/error/event/resource names recorded
  in this phase file or a directly linked contract note.
- A confirmation truth table covering all generation modes and replay/error
  outcomes.
- A route/resource/event matrix with auth and revision ownership.
- A schema/table/index/foreign-key matrix including backup classification.
- A job state and crash-point matrix.
- A prompt selection/budget/degradation contract.
- A lifecycle matrix for edit/delete/truncate/fork/import/export/restore/rebuild.
- Named focused tests or fixtures for every contract edge.

## Exit Criteria

- No implementation phase needs to invent a confirmation or ownership rule.
- Exact source-message selection can be expressed and unit-tested without a
  provider call.
- Exact domain/operational transaction boundaries are documented.
- Job lane design cannot starve existing Hypa work.
- Schema supports idempotency, provenance, manual edits, rebuild, and safe
  conflict handling without relying on filenames as identity.
- Prompt retrieval has explicit token and failure semantics.
- All open decisions are resolved or intentionally deferred with no impact on
  Phase 1.
- [`../status.md`](../status.md) records Phase 0 as complete and points to the
  first Phase 1 slice.

## Validation

This phase is documentation/contract-only. Validate internal consistency with:

```bash
pnpm exec prettier --check \
  docs/plan/bardwiki/README.md \
  docs/plan/bardwiki/PLAN.md \
  docs/plan/bardwiki/status.md \
  docs/plan/bardwiki/phases/*.md
```

If a pure contract helper or protocol fixture is added to prove feasibility,
run its focused tests plus both TypeScript projects before closing the phase.

## Risks

- Treating generation persistence as user acceptance would permanently ingest
  reroll candidates. The truth table must distinguish those states.
- Reusing current memory jobs without a lane design could block Hypa during long
  BardWiki model calls.
- A schema optimized only for current Markdown bodies would make source edits,
  safe rollback, and rebuild unreliable later.
- An over-broad first contract could turn the plan into a generic knowledge-base
  platform. Keep it chat-scoped and phase the optional features.
