# Scoped Assembly Load

Status: not started. Phase 2. Covers M1 plus assembly memo lows L1 and L2.

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

- The Phase 0 server load-count assertion shows zero `getAllChatMessagesGrouped`
  calls on the assembly path; only the target chat's messages are parsed.
- `RISU_PROTOCOL_METRICS=1` `databaseLoadMs` no longer scales with total corpus
  size for a single-chat send (measured on the Phase 0 fixture).
- Assembly golden-output tests are byte-identical.
- Gates `M1`, `L1`, `L2` registered in Phase 8.

## Validation

- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts`.
- `pnpm api:test`, both TypeScript checks.
