# H1 — Chat-Message Hydration Fallback Guard

Status: not started. Phase 1. The single highest-leverage fix in the plan: a
one-line guard change that removes a whole-corpus parse from every chat-open and
generation completion.

## Scope

`loadChatHydration` early-returns the cheap table-backed path only when
`message.length > 0 && hypaV3Data !== undefined`. For a normal (non-HypaV3) chat
`hypaV3Data` is `undefined`, so the guard fails and execution falls into the
"defensive, not-yet-extracted" branch that calls `loadPersisted(db, dataDir)` — a
full SQLite read + parse of every character and every chat-metadata row — which
then yields nothing (the embedded hypaV3 is also absent). Make the messages
table authoritative once populated.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  finding **H1**.
- `server/fastify/src/repository.ts:1061` (`loadChatHydration`), the fallback at
  `:1066` (`loadPersisted` + `eachChat`).
- `server/fastify/src/messageStore.ts` - `getChatHypaV3` (returns `undefined`
  with no row), `getChatMessages`, `getAlternateMessages`; the extraction writers
  (`replaceAllChatHypaV3`, `setChatHypaV3`) only insert a row when `hypaV3Data` is
  present.
- Callers: `server/fastify/src/routes/projection.ts:287` (chatMessages /
  `hydrateActiveChat`) and `:395` (generation.persisted).

## Planned Shape

- Early-return whenever `message.length > 0` (the messages table is authoritative
  for an extracted chat); a legitimately `undefined` `hypaV3Data` must not force a
  whole-corpus load.
- Keep the `loadPersisted` fallback only for a genuinely not-yet-extracted chat:
  `message.length === 0` (and ideally only when an embedded copy might exist).
- Do not change the returned shape (`{ message, hypaV3Data, alternates }`) or the
  embedded-fallback merge for the zero-rows case.

## Behavior / Invariants

- A chat with message-table rows and no `chat_hypa_v3` row returns table data
  without touching `loadPersisted`.
- A not-yet-extracted chat (zero message rows) still falls back to the embedded
  copy exactly as today.
- `hypaV3Data` for a non-HypaV3 chat is still returned as `undefined` (the
  fallback never produced a value for it anyway).
- Response bytes for both callers are identical.

## Done Criteria

- A regression test asserts `loadChatHydration` does **not** call `loadPersisted`
  for a chat that has message-table rows and no `chat_hypa_v3` row (use the Phase
  0 load-count spy), and **does** still serve the not-yet-extracted (zero-rows)
  fallback.
- `pnpm api:test -- server/fastify/__tests__/projection.test.ts` green; payloads
  unchanged.
- Gate `H1` registered in the Phase 8 completeness map.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts` + the new
  load-count test.
- `pnpm api:test`, both TypeScript checks.
