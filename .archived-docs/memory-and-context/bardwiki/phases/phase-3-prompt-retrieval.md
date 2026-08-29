# Phase 3: Deterministic Prompt Retrieval

Status: complete.

Goal: select and inject committed BardWiki content into prompt assembly using a
local, deterministic, budgeted path with no provider calls or autonomous writes.

## Progress

Slice 1 added a bounded query/snapshot/selection pipeline. Queries use bounded
NFKC/lowercase lexical terms and privacy-safe hashes. The repository hydrates
only the selected chat's committed active candidates, current search
projection, and bounded resolved-link closure; versions, jobs, receipts,
deleted/review documents, and sibling chats stay out of the prompt path. The
pure selector implements the locked score classes, stable path/id ties,
one/two-hop deduplication, heading-aware complete-paragraph excerpts, reference
wrappers, token/document shares, degraded-index behavior, and pinned overflow.

Slice 2 integrated those rows beside Hypa at `memory_bridge`. BardWiki-only
suppresses Hypa selection, follow-up work, and query-embedding prefetch; Hybrid
caps each mode and reduces BardWiki first when their sum exceeds the total.
Rows pass through both inline and prompt-template memory paths without
coalescing away independent removability. Pinned rows survive memory/final
budget trimming, while non-pinned rows may be removed before live history.
Preview and send assembly share the same committed snapshot and rows. Routine
metrics and request history receive hashes, ids, paths, reasons, headings,
counts, and token costs but no raw document bodies or query text.

Slice 3 closed the parity and observability boundary. Route tests compare the
same BardWiki rows across one-shot preview, the prompt SSE event, and provider
dispatch, while prompt-summary hashes remain authoritative. Request-history
metadata and routine metrics contain only privacy-safe selector fields and now
distinguish selected, retained, and final-trimmed rows. Preview maps pinned
allocation overflow to HTTP 409 and generation emits the same stable terminal
reason without provider dispatch. A 2,000-document representative run scored
the bounded 512-candidate set, selected 32 rows, and measured 8.53 ms; timing is
recorded diagnostically rather than enforced as a flaky wall-clock threshold.

Slice 4 ran the complete selector/adapter/assembly/memory/template/generation
regression, every server-facing typecheck, the production browser build, and
all 37 Playwright smoke scenarios. The feature remains a separate server-side
prompt concern and did not add a browser eager-load boundary.

Validation on 2026-08-29:

```text
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWikiRepository.test.ts \
  server/fastify/__tests__/bardWikiSelection.test.ts
# 2 files, 20 tests passed

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/memory.test.ts \
  server/fastify/__tests__/templates.test.ts \
  server/fastify/__tests__/bardWikiSelection.test.ts \
  server/fastify/__tests__/bardWikiPrompt.test.ts \
  server/fastify/__tests__/bardWikiRoutes.test.ts
# 6 files, 229 tests passed

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/memoryBudgetAllocator.test.ts
# 2 files, 181 tests passed

pnpm check:server
# protocol, client-library, browser-smoke, and Fastify typechecks passed

pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/bardWikiSelection.test.ts \
  server/fastify/__tests__/bardWikiPrompt.test.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/memory.test.ts \
  server/fastify/__tests__/templates.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/memoryBudgetAllocator.test.ts
# 7 files, 408 tests passed; representative 2,000-document selection: 8.53 ms

pnpm smoke:fastify-browser
# production browser build passed; 37 Playwright smoke tests passed
```

## Depends On

- Phase 2 manual documents and effective settings are usable.

## Scope

- Add a pure/testable BardWiki query builder using current input and a bounded
  recent transcript window.
- Add a repository snapshot optimized for prompt selection without hydrating
  document versions, receipts, or unrelated chats.
- Implement deterministic ranking using:
  - Required/pinned and always-context documents.
  - Exact normalized title and alias matches.
  - Lexical/FTS title, heading, and body matches.
  - Bounded one- or two-hop wikilink expansion.
  - Stable tie-breaking.
- Select heading-aware excerpts rather than whole documents when possible.
- Apply explicit document, link-hop, per-document, and total token budgets.
- Add `bardWiki` prompt rows to the existing `memory_bridge` stage.
- Extend memory-window/template handling so BardWiki rows work with and without
  the prompt-template memory card.
- Implement Hypa, BardWiki, and Hybrid modes with partitioned budgets.
- Add structured diagnostics and privacy-safe request-history/metrics summaries.
- Add preview and generation parity: the same committed snapshot and rows must
  be visible to prompt preview and provider dispatch.
- Define graceful degradation when the index is unavailable or a document is
  malformed; no job/provider work is performed on this path.

## Out of Scope

- Semantic embeddings.
- Background wiki updates.
- Waiting for pending jobs before generation.

## Anchors

- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/prompt/memory.ts`
- `server/fastify/src/prompt/templates.ts`
- `server/fastify/src/prompt/budgetFinalize.ts`
- `server/fastify/src/prompt/memoryAdapter.ts`
- `server/fastify/src/memoryBudgetAllocator.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/requestHistory.ts`
- `server/fastify/src/prompt/promptSummary.ts`

## Target Module Boundaries

- `server/fastify/src/prompt/bardWikiQuery.ts`: bounded query construction.
- `server/fastify/src/prompt/bardWikiSelection.ts`: deterministic ranking,
  link expansion, excerpting, and diagnostics.
- `server/fastify/src/prompt/bardWiki.ts`: assembly adapter and prompt-row
  formatting.

Exact names may follow Phase 0, but repository access, selection, and prompt
formatting should remain separable for tests.

## Implementation Slices

1. Bounded query/repository snapshot and pure rank/link/excerpt/budget selector.
2. Memory-bridge adapter, effective settings, mode partitioning, wrappers, and
   privacy-safe diagnostics.
3. Preview/SSE/request-history/provider parity, pinned HTTP/terminal errors,
   final-trim reconciliation, and representative large-corpus timing.
4. Full prompt/memory/generation regressions and phase closeout.

## Invariants

- No provider call and no durable write occurs during BardWiki retrieval.
- Pending/failed/stale jobs do not block generation; only committed active
  documents are visible.
- Identical database snapshot, query, and settings produce identical ordering.
- Selection cannot consume more than its effective budget.
- Hybrid mode does not silently add BardWiki budget on top of the full Hypa
  budget.
- At least the current user input and required prompt structure survive memory
  selection; pinned overflow follows the explicit Phase 0 error policy.
- Prompt preview, prompt event, request history, and provider dispatch agree on
  selected rows.
- Routine diagnostics never contain raw document bodies.
- Wiki excerpts are delimited as reference data and cannot masquerade as new
  top-level instructions through formatting alone.

## Required Coverage

- Exact title/alias, lexical heading/body, link expansion, unresolved links,
  duplicate suppression, and stable tie-breaking.
- Context policies and disabled/stale/review states.
- Document/excerpt/token budgets and pinned overflow.
- Empty/degraded index behavior.
- Hypa-only, BardWiki-only, and Hybrid allocation.
- Memory card and inline wrapper behavior.
- Final budget trimming and last-user-message preservation.
- Prompt preview/provider parity and privacy-safe diagnostics.
- Large candidate corpus stays within a defined query/runtime budget.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/memoryBudgetAllocator.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Add focused selector/query/adapter tests and include them in the phase proof.
Record representative selection timing for a Phase 0-sized corpus without
turning a local benchmark into a flaky unit-test threshold.

## Exit Criteria

- Manually authored wiki documents influence preview and generation exactly as
  configured.
- Retrieval is provider-free, deterministic, bounded, and observable.
- Hypa compatibility and final prompt budget behavior remain covered.
- Disabling BardWiki restores byte-compatible non-BardWiki assembly behavior
  apart from intentional diagnostics defaults.

## Risks

- Reusing lorebook activation directly would conflate two different priority
  and placement contracts. Share low-level utilities only where semantics match.
- Treating all selected documents as pinned could make ordinary chats fail
  context budgeting.
- Raw Markdown promoted to a system row can carry prompt-injection-like text;
  wrapper and policy behavior must be tested, not only documented.
