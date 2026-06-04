# Scoped Assembly Load

Status: not started. Phase 2. Covers M1 (the documented prompt-construction
leftover) plus the assembly-internal per-message memo lows L1, L2.

## Scope

Prompt assembly resolves its database through `loadPersistedWithMessages`, which
`SELECT`s and `JSON.parse`s the entire `messages` and `chat_hypa_v3` tables and
joins them onto every chat — though assembly reads only the active chat's
transcript. Hydrate only the target chat for assembly. Also memoize the
per-message active-module resolution and hoist invariant run-var work.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  **M1**, **L1**, **L2**.
- `server/fastify/src/routes/generationChat.ts:352` (`loadDatabaseDeps.loadDatabase`),
  `:868`/`:1527` (send/stream), `:1848` (preview).
- `server/fastify/src/repository.ts:855` (`loadPersistedWithMessages`),
  message-free `loadPersisted` (:735).
- `server/fastify/src/messageStore.ts:451` (`getAllChatMessagesGrouped`),
  `:467` (`getChatMessagesGroupedByIds`), the hypa equivalents.
- `server/fastify/src/prompt/assemble.ts` (`resolveScope` :397, `applyCurrentChatRunVars`
  :738), `server/fastify/src/prompt/modules.ts:40` (`getActiveModules`).

## Planned Shape

- Add an **assembly-specific** loader (not a change to `loadPersistedWithMessages`,
  which assetGc/export/save/import need broad): message-free `loadPersisted` +
  `getChatMessagesGroupedByIds([chatId])` + `getChatHypaV3GroupedByIds([chatId])`,
  joining only the target chat; every other chat gets `message=[]`.
- L1: memoize `getActiveModules` per assembly (port the SPA `lastModules` memo);
  it is invariant across the per-message history loop.
- L2: hoist the whole-transcript run-var expansion off the per-message path where
  the inputs are invariant.

## Behavior / Invariants

- Assembly output bytes (prompt, tokens, side effects) are identical; assembly
  only consumes the active chat's transcript, so scoping is behavior-compatible.
- Non-target chats must still expose `message=[]` so `eachChat` / memo iteration
  (`assemble.ts:1124`) does not regress; per-chat hypaV3 embedded-fallback
  semantics preserved.
- `loadPersistedWithMessages` and `getAllChatMessagesGrouped` are unchanged for
  their other callers.

## Done Criteria

- The Phase 0 server clone-cost assertion shows zero `getAllChatMessagesGrouped`
  calls on the assembly path; only the target chat's messages are parsed.
- `RISU_PROTOCOL_METRICS=1` `databaseLoadMs` no longer scales with total corpus
  size for a single-chat send (measured on the Phase 0 fixture).
- Assembly golden-output tests are byte-identical.
- Gates `M1`, `L1`, `L2` registered in Phase 8.

## Validation

- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts`.
- `pnpm api:test`, both TypeScript checks.
