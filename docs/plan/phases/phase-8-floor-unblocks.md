# Phase 8: Tier-5 Floor Unblocks (Scoped Subset)

Status: implemented. Phase 6 held the nine Tier-5 routes at their safe floor and
recorded the unblock prerequisites. Phase 8 landed the two prerequisites that gate
the **high-value subset** and narrowed those routes below the floor onto the
existing `targeted-character-row` path (8a `ad5f3cde`, 8b `a83c474a`). The
low-value Tier-5 routes stay at their floor by choice (see Non-Scope).

Goal: narrow the Tier-5 routes whose write range actually hurts — the
script/trigger PUTs (a 250 ms debounced watcher fires them repeatedly while a user
edits a character's regex/triggers) and the single chat delete (a frequent action
whose `hydrated` floor loads the entire corpus' messages to drop one chat). Both
collapse to one character row plus, for the delete, that character's chat rows and
a targeted message/hypa cleanup.

## Why this subset (frequency × cost)

The audit in Phase 6 floored all nine Tier-5 routes; Phase 8 only touches the ones
where frequency and per-call cost both justify it:

- `PUT characters/:id/scripts`, `PUT characters/:id/triggers` — **very frequent**
  (debounced watcher per edit; `scriptDefinitionBridge.svelte.ts`), currently
  `message-free` (full 13-table rewrite + a whole-DB `normalizeScriptDefinitionDatabase`
  pass) for a one-field change on one character.
- `DELETE chats/:id` — **frequent** (chat housekeeping), currently `hydrated`
  (`loadPersistedWithMessages` + `cloneJsonValue` over every message of every chat)
  to delete one chat.

Left at the floor (Non-Scope): `DELETE characters/:id` (occasional; reuses the
8b cleanup, deferred), `POST characters`, `POST characters/create-and-select`,
`POST modules` (rare/occasional one-shot button clicks), and `DELETE modules/:id`
(rare + a separate cross-table `removeModuleReferences` blocker).

## The two unblock prerequisites

1. **Normalization is validate-only at the persistence layer (8a).** The
   `normalizeScriptDefinitionDatabase` / `ensureCharacterCollection` /
   `normalizeAllCharacterChats` passes repair sibling rows in memory (assign/dedup
   ids). They already run at import (`risuSave/importSnapshot.ts`), and the target
   character's field is overwritten with a strictly-validated payload
   (`readScriptDefinitions` throws on a bad id). So the in-memory sibling repairs
   are redundant during a live edit. We keep running the pass (it still validates
   and locates the target) but persist **only the target character row**, so the
   sibling mutations are discarded — the same "validate-only via discard" the
   `characterUpdated` reference fix (`commands.ts:2563`) already relies on. No
   change to the normalizer itself.
2. **Targeted orphan-message cleanup (8b).** `deleteChatMessages` /
   `deleteChatHypaV3` already exist (`messageStore.ts`) and are already paired in
   `repository.ts`. Calling them directly removes the deleted chat's message and
   hypa rows, which is the only reason `DELETE chats/:id` stayed `hydrated` (the
   `syncChatMessages` diff did the orphan cleanup as a side effect of loading every
   message). With the targeted deletes wired in, the route drops the message load
   entirely.

## Source Anchors

- `server/fastify/src/routes/commands.ts` — `PUT characters/:id/scripts`
  (`:4543`), `PUT characters/:id/triggers` (`:4577`), `DELETE chats/:id` (`:2854`);
  reference `targeted-character-row` route `PATCH characters/:id` (`:2563`).
- `server/fastify/src/commands/scriptDefinitions.ts` — `normalizeScriptDefinitionDatabase`,
  `readCharacterScriptParent`, the strict `readScriptDefinitions`/`readTriggerDefinitions`.
- `server/fastify/src/commands/chats.ts` — `normalizeAllCharacterChats`,
  `requireChatLocation`, `ensureCharacterChats`, `selectedChatId`.
- `server/fastify/src/repository.ts` — `writeSingleCharacterRow`,
  `writeCharacterChatRows`, and the new `deleteCharacterChatRow`.
- `server/fastify/src/messageStore.ts` — `deleteChatMessages`, `deleteChatHypaV3`.
- `server/fastify/src/commands/mutations.ts` — `applyTargetedCommandMutation`,
  `TARGETED_MUTATION_PATHS.characterRow`.

## Slices

- [`scripts-triggers-character-row.md`](slices/phase-8-floor-unblocks/scripts-triggers-character-row.md)
  (8a) — route the two script/trigger PUTs onto `targeted-character-row`.
- [`chat-delete-character-row.md`](slices/phase-8-floor-unblocks/chat-delete-character-row.md)
  (8b) — route `DELETE chats/:id` onto `targeted-character-row` + targeted
  message/hypa delete.

## Projection / Event Behavior

No projection change. The emitted events and their resources are unchanged
(`scriptDefinitions.replaced` → `scriptDefinition`, `triggerDefinitions.replaced`
→ `triggerDefinition`, `chat.deleted` → `chat`), so the client refreshes exactly
as before; the narrowed writes update the same SQLite rows the projection reads.

## Exit Criteria

- `PUT characters/:id/scripts` and `PUT characters/:id/triggers` report
  `mutationPath: targeted-character-row` with `writtenTables: ['characters']` and
  `dbJsonWriteMs: 0`; unrelated character/chat/collection rowids stay stable. (Met.)
- `DELETE chats/:id` reports `mutationPath: targeted-character-row`, loads no
  messages, writes only the parent character row + that character's chat rows +
  the deleted chat's message/hypa rows (`writtenTables: ['characters',
  'chat_hypa_v3', 'chats', 'messages']`), and leaves no orphan message/hypa rows;
  unrelated rows stay stable. (Met.)
- The normalization-drop decision (validate-only via discard) is recorded; no
  global repair is silently dropped without it. (Met — recorded in both slices.)
- Each slice lands with a rowid-stability regression test and the metric gate.
  (Met — `commandFloorUnblock.test.ts`, 5 tests.)

## Validation

- `pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/commandFloorUnblock.test.ts`
- `pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/commandMetrics.test.ts`
- `pnpm api:test`
- `pnpm test`
- `pnpm client-thinning:audit`
- Type check: `pnpm exec tsc -p tsconfig.client-lib.json` then
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
