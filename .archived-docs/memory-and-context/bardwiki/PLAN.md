# BardWiki Memory

Date: 2026-08-29

## Goal

Add a per-chat wiki-based memory system that preserves the useful BardWiki
semantics from RisuBard while conforming to this project's server-authoritative
SQLite, revision, resource, and generation contracts.

End state:

- Each chat can own Markdown event and canonical documents with stable ids,
  logical paths, document history, source provenance, and `[[wikilinks]]`.
- Users can configure BardWiki under the existing Memory settings page and can
  inspect/edit the active chat's wiki from a chat-scoped workspace.
- Confirmed transcript turns create durable, idempotent background work owned by
  Fastify; browser lifetime and SSE delivery are irrelevant to correctness.
- Model-generated updates are fully validated and committed atomically through
  a revisioned command mutation after provider work completes.
- Prompt assembly retrieves committed wiki excerpts deterministically without a
  provider call or a wait for background processing.
- Users can observe failures, retry or rebuild safely, export an
  Obsidian-compatible Markdown vault, and recover the entire feature through
  normal backup/restore.

## Boundary Sources

- [`README.md`](README.md) owns the read order and source-anchor map.
- [`status.md`](status.md) owns the live execution cursor.
- Phase files own implementation handoff details and focused validation.
- The current code and architecture guides remain authoritative when this plan
  drifts.
- `/home/codex/RisuBard` is a semantic reference for event documents, canonical
  documents, wikilinks, lexical retrieval, and two-stage writing. It is not the
  authority for persistence, transactions, routing, or background execution in
  this repository.

## Locked Product Decisions

### UI ownership

- Keep the stable settings index and `/settings/other-bots` compatibility route.
- Add BardWiki as an inner tab of the existing Memory page, implemented as an
  extracted lazy component rather than expanding `OtherBotSettings.svelte`
  inline.
- The settings tab owns global defaults, model/prompt selection, retrieval
  budgets, update policy, and import/export entry points.
- The active chat's document tree, Markdown editor, source/version inspection,
  and job controls belong in a chat-scoped drawer, dock, or modal. Settings must
  not become the primary document workspace.
- A `/settings/memory` alias may be added without removing
  `/settings/other-bots`. Direct BardWiki subtab deep-linking is optional and
  must not delay the first usable slice.

### Authority and storage

- SQLite is the only live authority. Markdown files are an import/export format,
  not a second synchronized store.
- Browser resource state is a disposable projection. No IndexedDB wiki database
  or browser-owned processing cursor is introduced.
- Document ids are stable and independent of title/path. Logical paths are
  validated user-facing attributes used for navigation and export.
- Event documents and canonical documents share one document model but have
  distinct kinds and lifecycle rules.
- Document versions, transcript sources, applied turn receipts, and link edges
  are durable first-class records.
- Search/link indexes may be derived and rebuildable, but every SQLite table,
  including FTS shadow tables when applicable, must be explicitly covered by
  backup classification tests.

### Confirmation semantics

- Completing an assistant generation does not confirm that assistant for
  BardWiki; it may still be continued, regenerated, or replaced.
- Automatic mode confirms the preceding assistant turn only after a later
  `send` finalizes successfully.
- The assistant produced by that `send` remains unconfirmed until a later send
  or an explicit confirmation.
- `regenerate` never automatically confirms a turn.
- `continue` never automatically confirms the current assistant turn, even
  though existing reroll-buffer bookkeeping treats send/continue as a boundary.
- An explicit `Confirm to BardWiki` command can confirm the current active
  assistant using expected message ids and content hashes.
- Automatic and explicit confirmation are server-side, idempotent, and durable.
  Provider stream events, browser `done` handling, and live SSE listeners are
  not scheduling authorities.

### Background processing

- The existing memory job repository/worker behavior is the starting point for
  claiming, retry, cancellation, restart recovery, fairness, and live status.
- Long BardWiki model calls must not share the current Hypa single-flight lane.
  The worker mechanics will be generalized or filtered into separate Hypa and
  BardWiki execution lanes before autonomous updates ship.
- Job payloads contain identifiers, expected hashes, and bounded configuration
  snapshots where required; they do not duplicate whole transcripts or store
  secrets.
- Provider credentials and current model-profile configuration are resolved at
  execution time through existing server model/profile boundaries.
- SQLite transactions never remain open during provider calls.
- A worker stages and validates the complete change set, rechecks source and
  document hashes, then commits all document changes, versions, sources, links,
  receipt state, one revision bump, and one persisted command event atomically.
- A crash after the document commit but before operational job completion must
  replay as a receipt-backed no-op rather than create duplicate documents.

### Prompt retrieval

- Retrieval runs in the server prompt assembly `memory_bridge` stage.
- Prompt-time selection is local, deterministic, abort-aware, and bounded. It
  never invokes a provider and never waits for pending update jobs.
- Initial ranking uses pinned/always context, exact title/alias matches,
  lexical/FTS matches, heading-aware excerpts, and bounded wikilink expansion.
  Semantic embeddings are deferred until this path is proven.
- BardWiki rows have their own memo identity and wrapper, while remaining
  compatible with the existing prompt-template memory card.
- Hypa, BardWiki, and Hybrid are explicit modes. Hybrid has independent token
  budgets and must not silently double the memory budget.
- Retrieved wiki content is delimited as reference data, not executable
  instructions. Diagnostics record ids, hashes, counts, scores, and token usage,
  not raw document bodies.

### Safe rollout

- BardWiki is off by default and does not incur provider costs until enabled.
- Manual Markdown CRUD and deterministic retrieval ship before autonomous
  model-authored canonical changes.
- Explicit confirmation initially creates event documents only. Canonical
  document mutation lands in a later phase after receipt, retry, conflict, and
  version behavior are proven.
- Existing chats are not silently backfilled. A user invokes a rebuild when
  they want historical transcript ingestion.

## Terminology and State Model

- **Candidate turn**: the active assistant response that may still change.
- **Confirmed turn**: a user/assistant source pair accepted for BardWiki by the
  automatic or explicit policy.
- **Turn receipt**: the durable idempotency and provenance row for one exact
  source version.
- **Event document**: an append-oriented Markdown account of one confirmed
  interaction or extracted event.
- **Canonical document**: a maintained character, location, scene, faction,
  item, concept, or other long-lived wiki document.
- **Change set**: validated event/canonical document writes associated with one
  receipt and job.
- **Stale receipt**: a receipt whose source messages no longer match their
  recorded hashes.
- **Reconcile**: update or safely reverse a stale receipt's effects without
  overwriting unrelated/manual edits.
- **Rebuild**: produce a fresh derived corpus from the retained transcript under
  an explicit user action.

Conceptual state flow:

```text
candidate
   ├─ later successful send ─┐
   └─ explicit confirmation ─┴─> confirmed/queued
                                      │
                                      v
                            running -> applied
                               │          │
                               ├─> failed │ source edit/delete
                               └──────────┴─> stale -> reconcile/rebuild
```

## Target Data Model

Phase 0 locks exact names and constraints. The conceptual schema is:

### `bardwiki_chat_settings`

- Chat foreign key with cascade lifecycle.
- Enabled state and optional overrides of global update/retrieval defaults.
- Automatic/manual confirmation mode.
- Retrieval mode and token/document/link-hop budgets.
- Last successful rebuild metadata where useful.

### `bardwiki_documents`

- Stable id and chat foreign key.
- Kind: event, character, location, scene, faction, item, concept, or other.
- Title, normalized logical path, optional aliases, and context policy.
- Markdown body, content hash, version number, review state, and timestamps.
- Unique normalized path per chat; path is never the document identity.

### `bardwiki_document_versions`

- Document id/version and prior body/hash/metadata.
- Actor and reason: user command, analysis job, reconcile, rebuild, or import.
- Related job, receipt, and command revision when applicable.

### `bardwiki_turn_receipts`

- Chat, source user/assistant message ids, source hashes, and confirmation mode.
- Stable receipt identity, event document id, job id, state, error summary, and
  timestamps.
- Enough before/after manifest data to recognize replay and determine whether a
  safe inverse is possible.

### `bardwiki_document_sources`

- Document/version to receipt/message provenance edges.
- Source hashes retained for staleness and rebuild diagnostics.

### `bardwiki_links`

- Source document, raw wikilink target, normalized target, and optional resolved
  document id.
- Rebuilt transactionally when a document body changes.

### Search index

- A derived, rebuildable index over title, aliases, headings, and Markdown body.
- Exact implementation may begin with bounded lexical scanning and move to FTS5
  without changing the selector contract.

### Jobs

- Reuse and evolve the durable memory-job machinery rather than adding an
  unrelated browser queue.
- Expected kinds include analyze-event, apply-canon, reconcile, and rebuild,
  though Phase 0 may collapse stages when one atomic job is safer.
- The public Hypa job-create contract must not accept arbitrary BardWiki jobs.

## Command, Resource, and Event Boundaries

Exact route names are a Phase 0 contract, following these ownership rules:

- Authenticated targeted reads list the active chat's BardWiki settings,
  document index, individual document bodies/versions, receipts, and job status.
- Manual document create/update/delete, chat settings, explicit confirmation,
  import, and rebuild intent use active-writer commands with base revision and
  narrow optimistic preconditions.
- Document update also carries an expected document content hash or version.
- Operational job cancel/retry observation may remain outside the global
  revision, matching existing memory-job behavior.
- Background document commits are revisioned domain mutations. They persist a
  replayable command event so disconnected clients invalidate/refetch after
  reconnect; live memory events alone are insufficient.
- Resource invalidation is targeted by chat and document id where practical.
- Every route is declared in the server route manifest and protected by auth,
  active-writer, SSE/JSON, and request-size tests appropriate to its contract.

## Update Pipeline

1. The confirmation transaction resolves the exact active source rows and
   records their ids/hashes.
2. It inserts or reuses the turn receipt and pending job atomically with the
   confirmation boundary.
3. After commit, the BardWiki worker lane is woken; polling remains the durable
   fallback.
4. The worker claims the job and rereads its receipt, source rows, effective
   BardWiki settings, and model profile.
5. It snapshots relevant committed documents and hashes.
6. Analysis produces a strict structured event draft.
7. Canonical compilation, when enabled, produces bounded structured section
   operations against explicit document ids/base hashes.
8. All model output is schema-, path-, size-, kind-, and patch-validated. One
   bounded repair attempt may be allowed; invalid output cannot partially write.
9. A short revisioned transaction rechecks source and document hashes and
   commits the entire change set.
10. The command event invalidates BardWiki resources; job status is completed
    operationally after the domain commit.

Source edits, deletes, truncations, and alternate replacement must detect
affected receipts in the same transcript mutation. Pending work is cancelled or
obsoleted. Applied work becomes stale and is reconciled or rebuilt; automatic
rollback is allowed only when every affected document still matches the
recorded after-hash.

## Prompt Retrieval Contract

The selector consumes:

- Effective chat/global BardWiki settings.
- Current user input and a bounded recent transcript query window.
- Committed active documents and their link/search projections.
- Prompt context budget and tokenizer.

The selector returns:

- Ordered `bardWiki` system rows or one bounded aggregate row.
- Selected document ids, paths, hashes, score reasons, excerpt headings, and
  token costs.
- Candidate/selected/link-expansion counts and a stable query hash.
- A disabled/empty/degraded reason when no rows are emitted.

Selection order is deterministic for identical inputs. Required/pinned content
that cannot fit must produce an explicit prompt-assembly error or warning
defined in Phase 0; it must not be silently truncated into misleading content.

## Invariants

- Fastify/SQLite is authoritative; browser state is never the wiki database.
- No provider call, filesystem write, or long computation occurs inside a
  revision transaction.
- A confirmed source version is applied at most once.
- Job retry, process restart, duplicate command replay, and post-commit crash do
  not duplicate event documents or canonical changes.
- One failed or malformed model result cannot leave a partially updated wiki.
- Manual edits are never overwritten by a stale model snapshot.
- Message edit/delete/truncate and chat delete/fork/import behavior are explicit
  and tested before automatic updates are considered complete.
- User-visible document/settings writes bump the global revision exactly once
  and persist one replayable command event.
- Operational job transitions do not pretend to be domain revisions.
- Prompt generation reads the latest committed snapshot and never waits for a
  pending BardWiki job.
- BardWiki cannot starve Hypa background work or the chat generation hot path.
- Credentials, raw private prompt bodies, and whole document bodies are absent
  from routine metrics and job events.
- Every visible string is defined under `src/lang` with English as the complete
  contract.

## Phase Overview

- [Phase 0: Contract and architecture lock](phases/phase-0-contract-and-architecture.md)
  defines exact types, states, routes, events, settings inheritance,
  confirmation behavior, failure semantics, and acceptance tests.
- [Phase 1: Persistence and server resources](phases/phase-1-persistence-and-resources.md)
  adds schema, repositories, targeted reads, revisioned document/settings
  commands, provenance/version/link storage, and backup classification.
- [Phase 2: Settings and manual workspace](phases/phase-2-settings-and-workspace.md)
  adds the BardWiki Memory tab, chat-scoped editor/workspace, manual CRUD, and
  resource reconciliation without autonomous writes.
- [Phase 3: Deterministic prompt retrieval](phases/phase-3-prompt-retrieval.md)
  adds local ranking, wikilink expansion, token budgeting, memory-card
  integration, Hybrid policy, and diagnostics.
- [Phase 4: Durable jobs and explicit event memory](phases/phase-4-jobs-and-explicit-confirmation.md)
  separates worker lanes, adds explicit confirmation, and generates atomic
  event documents without canonical mutations.
- [Phase 5: Automatic confirmation and canonical updates](phases/phase-5-automatic-and-canonical-updates.md)
  attaches prior-turn confirmation to successful sends, adds validated two-stage
  canonical patches, and handles stale-source reconciliation.
- [Phase 6: Lifecycle, rebuild, and interchange](phases/phase-6-lifecycle-and-interchange.md)
  closes edit/delete/truncate/fork/import/export/restore/rebuild and large-corpus
  operational behavior.
- [Phase 7: Verification and closeout](phases/phase-7-verification-and-closeout.md)
  runs the complete regression, performance, browser, recovery, documentation,
  and rollout matrix.

## Delivery and Verification Policy

- Implement one phase at a time; do not start a dependent phase while its
  predecessor has unresolved correctness gaps.
- Keep schema/repository, prompt, worker/model, and UI patches separately
  reviewable when their write sets allow it.
- Add focused tests with each behavioral slice rather than deferring coverage to
  Phase 7.
- Use `pnpm test:affected` or the owning focused files during implementation,
  then run each phase's listed validation before marking it complete.
- Update [`status.md`](status.md) after every completed slice with commits,
  validation, residual risks, and the next exact action.
- Update current architecture guides as behavior lands. Plan files describe
  intended work and must not be treated as shipped behavior.
- Create `latest-verification.md` during Phase 7 with the final proof matrix,
  then move the complete workstream to `.archived-docs/` without discarding its
  plan/status/phase history.

## Not In This Plan

- Live bidirectional filesystem or Obsidian vault synchronization.
- Browser-local authoritative storage, peer sync, or offline wiki mutation.
- Multi-writer concurrency beyond the existing active-writer contract.
- Semantic/vector retrieval in the initial delivery.
- General graph visualization, collaborative editing, or a full Obsidian clone.
- Automatic ingestion of all historical chats on enablement.
- Cross-chat or cross-character wiki sharing in the initial schema.
- Arbitrary model-authored file paths or whole-document replacement without
  validation and optimistic hash checks.
- Removal of Hypa V3 or changes to its behavior except the worker refactor needed
  to prevent BardWiki starvation.

## Execution Cursor

Planning artifacts are complete. No runtime implementation has started. Begin
with [Phase 0](phases/phase-0-contract-and-architecture.md) and update
[`status.md`](status.md) before opening Phase 1.
