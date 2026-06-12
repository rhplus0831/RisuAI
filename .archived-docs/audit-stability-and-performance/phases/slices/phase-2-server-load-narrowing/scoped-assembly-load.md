# Scoped Assembly Load

Status: DONE (`c193c008`). Phase 2. Covers M1 plus assembly memo lows L1 and L2.

Landed shape:

- M1 — `loadPersistedForAssembly(db, dataDir, chatId)`
  (`server/fastify/src/repository.ts`): message-free `loadPersisted` +
  `getChatMessagesGroupedByIds`/`getChatHypaV3GroupedByIds` for the target chat
  only; every sibling chat gets `message = []`; the target keeps the broad
  loader's embedded-array fallback. Wired into `loadDatabaseDeps` in
  `routes/generationChat.ts` (send/stream/durable/preview all route through
  `assemblePromptWithMetrics`). `loadPersistedWithMessages` unchanged for
  assetGc/export/save/boot-backfill.
- L1 — `getActiveModules` memo (`prompt/modules.ts`): WeakMap keyed on the
  loaded `Database` object + requested-id JSON key + `database.modules` array
  ref. Fresh per-request loads can never hit a stale entry.
- L2 — `applyCurrentChatRunVars` (`prompt/assemble.ts`): invariant expand
  context hoisted out of the loop; marker-free bodies (no `{`, no
  `<user|char|bot>` tag — exported predicate `isRunVarParserFixedPoint`) skip
  the per-message parse as proven parser fixed points.
- Regression tests: `serverLoadCostHarness.test.ts` (M1 route load-count,
  loader equivalence, embedded fallback), `modulesMemo.test.ts` (L1),
  `assemble.test.ts` "Phase 2 L2 run-var fixed-point skip" (L2).

## Scope

Prompt assembly uses `loadPersistedWithMessages`, which parses all
`messages`/`chat_hypa_v3` rows even though assembly reads only the active chat.
Hydrate only the target chat. Memoize active modules and hoist invariant run-var
work.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  M1, L1, L2.
- `server/fastify/src/routes/generationChat.ts:352` (`loadDatabaseDeps.loadDatabase`),
  `:868`/`:1527` (send/stream), `:1848` (preview).
- `server/fastify/src/repository.ts:855` (`loadPersistedWithMessages`),
  message-free `loadPersisted` (:735).
- `server/fastify/src/messageStore.ts:451` (`getAllChatMessagesGrouped`),
  `:467` (`getChatMessagesGroupedByIds`), the hypa equivalents.
- `server/fastify/src/prompt/assemble.ts` (`resolveScope` :397, `applyCurrentChatRunVars`
  :738), `server/fastify/src/prompt/modules.ts:40` (`getActiveModules`).

## Planned Shape

- Add an assembly-specific loader. Do not change `loadPersistedWithMessages`,
  which assetGc/export/save/import need broad. Use message-free `loadPersisted`
  plus targeted message/hypa loaders; give other chats `message=[]`.
- L1: memoize `getActiveModules` per assembly (port the SPA `lastModules` memo);
  it is invariant across the per-message history loop.
- L2: hoist the whole-transcript run-var expansion off the per-message path where
  the inputs are invariant.

## Behavior / Invariants

- Assembly output bytes are identical; assembly consumes only the active chat's
  transcript.
- Non-target chats must still expose `message=[]` so `eachChat` / memo iteration
  (`assemble.ts:1124`) does not regress; per-chat hypaV3 embedded-fallback
  semantics preserved.
- Keep `loadPersistedWithMessages` and `getAllChatMessagesGrouped` unchanged for
  other callers.

## Done Criteria

- [x] The Phase 0 server load-count assertion shows zero `getAllChatMessagesGrouped`
  calls on the assembly path; only the target chat's messages are parsed
  (`serverLoadCostHarness.test.ts` "M1: prompt assembly performs zero
  whole-corpus message/hypa payload reads").
- [x] `RISU_PROTOCOL_METRICS=1` `databaseLoadMs` no longer scales with total corpus
  size for a single-chat send — the assembly load now reads one chat's rows
  plus the character/collection tables, never the messages/hypa corpus.
- [x] Assembly golden-output tests are byte-identical (full server suite green;
  loader-equivalence test proves the target chat loads identically).
- [x] Gates `M1`, `L1`, `L2` registered in Phase 8 (`fixCompletenessGate.test.ts`).

## Validation

- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts`.
- `pnpm api:test`, both TypeScript checks.
