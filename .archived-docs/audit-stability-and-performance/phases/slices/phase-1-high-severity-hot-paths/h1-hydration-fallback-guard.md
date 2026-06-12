# H1 — Chat-Message Hydration Fallback Guard

Status: IMPLEMENTED (`0dc7452e`). Phase 1. Highest-leverage fix: a guard change
that removes a whole-corpus parse from chat-open and generation completion.

Landed shape: `loadChatHydration` early-returns whenever `message.length > 0`
(messages table authoritative once populated; extraction writes messages and
hypaV3Data together). The `loadPersisted` fallback remains for zero-row
not-yet-extracted chats. Proof in
`server/fastify/__tests__/serverLoadCostHarness.test.ts`: the no-hypa hydration
is asserted scoped (0 corpus loads, was 13 on the default fixture), and a new
zero-row regression (raw chats row with embedded `message`, no messages-table
rows) proves the defensive fallback still hydrates from the embedded copy.
Gate `H1` flipped to DONE in `fixCompletenessGate.test.ts` +
`active-risk-analysis.md`.

## Scope

`loadChatHydration` only returns the table-backed path when
`message.length > 0 && hypaV3Data !== undefined`. Normal non-HypaV3 chats have
`hypaV3Data === undefined`, so they fall into `loadPersisted(db, dataDir)` and
parse the corpus for no useful result. Make the messages table authoritative
once populated.

## Source Anchors

- [`../../../audit-stability-and-performance.md`](../../../audit-stability-and-performance.md) -
  finding H1.
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
- Keep `loadPersisted` fallback for genuinely not-yet-extracted chats
  (`message.length === 0`).
- Do not change the returned shape (`{ message, hypaV3Data, alternates }`) or the
  embedded-fallback merge for the zero-rows case.

## Behavior / Invariants

- A chat with message rows and no `chat_hypa_v3` row returns table data without
  touching `loadPersisted`.
- A not-yet-extracted chat (zero message rows) still falls back to the embedded
  copy exactly as today.
- `hypaV3Data` for a non-HypaV3 chat is still returned as `undefined` (the
  fallback never produced a value for it anyway).
- Response bytes for both callers are identical.

## Done Criteria

- A regression test asserts no `loadPersisted` call for a chat with message rows
  and no `chat_hypa_v3` row, while zero-row fallback still works.
- `pnpm api:test -- server/fastify/__tests__/projection.test.ts` green; payloads
  unchanged.
- Gate `H1` registered in the Phase 8 completeness map.

## Validation

- `pnpm api:test -- server/fastify/__tests__/projection.test.ts` + the new
  load-count test.
- `pnpm api:test`, both TypeScript checks.
