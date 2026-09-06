# Lorebook activation and memory systems (`LM`)

Fastify side: `server/fastify/src/prompt/lorebook.ts`, `memory.ts`,
`memoryAdapter.ts`, and the server memory modules (`memoryPlanner.ts`,
`memorySelectionService.ts`, `memorySimilarityRanking.ts`). Original side:
`src/ts/process/lorebook.svelte.ts` and `src/ts/process/memory/*`
(all `@71c476e9c`). See [README.md](README.md) for baseline and format.

## Open findings

### LM-1 — Similar-memory retrieval is disabled in the live route [high]

- **Verification:** code-verified
- **Classification:** BUG
- **Fastify:** `server/fastify/src/routes/generationChat.ts:790`
  (`loadPromptMemoryQueryVectors: () => []`),
  `server/fastify/src/memorySimilarityRanking.ts:58`
- **Original:** `src/ts/process/memory/hypav3.ts:1327-1420` `@71c476e9c`
- **Difference:** The live generation route supplies an empty query-vector
  loader; `rankMemorySummariesBySimilarity` returns no candidates without
  valid query vectors. Only tests can inject vectors, so production
  similarity selection never happens. The original embedded recent chat text
  and ranked stored summaries against those embeddings.
- **Scenario:** Hypa V3 with recent/important/random ratios at zero and
  similar ratio at one; summaries about "cat" and "dog" stored; discuss cats.
  The original selects the cat summary; Fastify injects no memory.

### LM-2 — The planner's clipped-history start index is not applied [high]

- **Verification:** code-verified (`startIndex` exists only in
  `memoryPlanner.ts`/`memoryChunkPlanner.ts`; no assembly consumer slices
  `historyMessages`, and `fillMemoryAndPostHistory` feeds the full history
  into the memory window)
- **Classification:** BUG
- **Fastify:** `server/fastify/src/memoryPlanner.ts:214`,
  `server/fastify/src/prompt/assemble.ts:1648`, `:1726`
- **Original:** `src/ts/process/memory/hypav3.ts:990-1007`, `:1593-1600`
  `@71c476e9c`
- **Difference:** Fastify computes `startIndex` and an adjusted token count,
  but assembly uses the plan only for summary-job planning and diagnostics —
  every `historyMessage` is still appended. The original injected only
  `chats.slice(startIdx)`, removing summarized rows from history.
- **Scenario:** A stored summary covers messages 0–1; messages 2–3 are
  unsummarized; enough context to avoid generic trimming. The original sends
  summary + messages 2–3; Fastify sends summary + messages 0–3, duplicating
  the summarized conversation.

### LM-3 — Empty `@@exclude_keys_all` has opposite behavior [low]

- **Verification:** agent-reported
- **Classification:** BUG
- **Fastify:** `server/fastify/src/prompt/lorebook.ts:442`, `:730`
- **Original:** `src/ts/process/lorebook.svelte.ts:181-227`, `:452-458`
  `@71c476e9c`
- **Difference:** Fastify treats an empty all-key query as not matched; the
  original initialized the all-key result to `true`, so a bare
  `@@exclude_keys_all` suppressed the entry.
- **Scenario:** Entry keyed `cat` starting with a bare `@@exclude_keys_all`,
  message containing `cat`: Fastify activates it; the original excluded it.

### LM-4 — Sticky lorebook activation ignores default variables [low]

- **Verification:** agent-reported (root cause is
  [HC-1](history-cbs-variables.md); fixing the shared chat-var backend
  resolves this)
- **Classification:** UNCLEAR — the `__internal_ka_*` variable names may not
  be a supported user-facing interface.
- **Fastify:** `server/fastify/src/prompt/lorebook.ts:156`, `:780`
- **Original:** `src/ts/parser/chatVar.svelte.ts:5-24`,
  `src/ts/process/lorebook.svelte.ts:326-344` `@71c476e9c`
- **Difference:** Sticky internal variables (`@@keep_activate_after_match`)
  are read only from `chat.scriptstate`; the original lookup fell back to
  character/template default variables.

## Confirmed intentional divergences (no work items)

- **Hypa V3 summaries are separate raw system rows** rather than one
  `<Past Events Summary>` wrapper row (different overhead can also change
  selection near the limit). Pinned by
  `server/fastify/__tests__/assemble.test.ts:2446` and
  `server/fastify/__tests__/promptMemoryAdapter.test.ts:400`.
- **New summaries are worker-deferred** — the generation that crossed the
  threshold does not wait for or include the new summary. Documented in
  `docs/structure/backend.md:260-276`.
- **Legacy memory algorithms are removed** — SupaMemory, legacy HypaMemory,
  Hypa V2, Hanurai, and experimental Hypa V3 do not run; old
  `supaMemoryData`/`hypaV2Data` are not honored as active generation state
  (legacy Hypa V3 summary import is supported). Documented in
  `docs/structure/generated-and-legacy.md:181-187`; experimental fallback
  pinned by `server/fastify/__tests__/memoryPlanner.test.ts:54`.
- **Invalid Hypa V3 ratios no longer abort generation** (planner diagnostics
  plus clamped allocation instead of a hard error). Pinned generally by
  `server/fastify/__tests__/assemble.test.ts:3052`.
- **Lorebook regex keys parse conventionally** (`/pattern/flags`; the
  original left the leading slash in the source and skipped empty-flag
  regexes). Pinned by `server/fastify/__tests__/lorebook.test.ts:468`.

## Areas verified clean

Character/chat/module lorebook aggregation order and deduplication;
case-insensitive matching, selective secondary keys, scan-depth text
construction, full-word behavior, comment stripping; recursive scanning and
per-entry recursion controls; activation probability, ordering, stable
priority ties, token-budget cutoff order, `ignore_on_max_context`;
position/depth/role insertion and description/personality/scenario/
author-note targets; timing/greeting/scan-depth/priority/role/recursion/
activation-window decorators apart from the reported edge cases; standard
Hypa V3 trigger/chunk calculations and allocation when valid query vectors
are supplied; legacy Hypa V3 summary import and model-compatibility checks;
generic non-memory history trimming and memory-card placement.
