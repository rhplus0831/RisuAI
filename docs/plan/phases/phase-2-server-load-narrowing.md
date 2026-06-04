# Phase 2: Server Load Narrowing (Root 1)

Status: not started. Addresses the audit's largest cross-cutting root — the
server still reconstitutes a broad in-memory `Database` (every character, every
chat-metadata row, all 9 collection tables, the full asset table) on most hot
read and write paths, even when the path reads one row. Depends on Phase 0's
server clone-cost assertion.

Goal: each hot path loads only the rows it reads. Add an assembly-specific scoped
message loader and a per-request load memo / field-scoped loader, then route the
hot read/write paths through them. Keep `loadPersisted` /
`loadPersistedWithMessages` for their genuine full-corpus consumers
(assetGc/export/save/import).

Findings: **M1, M3, M4, M5, L1, L2, L5, L6, L10, U1**.

## Source Anchors

- [`../audit-stability-and-performance.md`](../audit-stability-and-performance.md) -
  M1, M3, M4, M5, L1, L2, L5, L6, L10, U1.
- `server/fastify/src/repository.ts` - `loadPersisted` (:735/:747),
  `loadCharactersFromSqlite` (:288), `loadCollectionsFromSqlite` (:129),
  `getAllAssetMetadata` (:629), `loadStubbedProjectionFields` (:767),
  `loadSingleCharacterRow` (projection.ts:519), `loadPersistedWithMessages` (:855).
- `server/fastify/src/messageStore.ts` - `getAllChatMessagesGrouped` (:451),
  `getChatMessagesGroupedByIds` (:467), `getAllChatHypaV3Grouped` /
  `getChatHypaV3GroupedByIds`.
- `server/fastify/src/commands/mutations.ts` - `applyTargetedCommandMutation`
  (:147) and the message/scriptstate/generation mutate callbacks.
- `server/fastify/src/routes/projection.ts` - the `characterRow` branch
  (:358-385), the bulk-hydration loaders (`loadChatHydrations`,
  `loadCharacterLorebookHydrations`), `emitProjectionMetric` (:555).
- `server/fastify/src/routes/bootstrap.ts` - `maskProviderSecrets` clone (:31-45).
- `server/fastify/src/providerSecrets.ts` - `maskProviderSecrets`,
  `cloneJsonValue` (:247).
- `server/fastify/src/routes/events.ts` - command-event history load (:76).
- `server/fastify/src/prompt/modules.ts` (`getActiveModules`),
  `server/fastify/src/prompt/assemble.ts` (`applyCurrentChatRunVars`).

## Slices

- [`scoped-assembly-load.md`](slices/phase-2-server-load-narrowing/scoped-assembly-load.md) -
  M1, L1, L2. New assembly-specific loader hydrates only the target chat's
  messages/hypaV3 (`getChatMessagesGroupedByIds([chatId])` + message-free
  `loadPersisted`), leaving siblings `message=[]`; memoize `getActiveModules` per
  assembly; hoist the invariant run-var/module work off the per-message path.
- [`command-mutation-read-narrowing.md`](slices/phase-2-server-load-narrowing/command-mutation-read-narrowing.md) -
  M3, L5, L6. A field-scoped SQLite loader or per-request memo so a
  message/scriptstate/generation mutation parses only `characters` (+settings),
  not all collections, the full asset table, or all chat rows. Preserve the
  global `normalizeAllCharacterChats` dedup invariant.
- [`single-character-projection.md`](slices/phase-2-server-load-narrowing/single-character-projection.md) -
  M4. `loadSingleCharacterRow` does a `WHERE id=?` single-row read (precedent
  `loadCharacterSelectionRows`) and masks only that row; add an opt-in
  `maskProviderSecretsInPlace` for callers that own a fresh object.
- [`projection-metric-and-bulk-read.md`](slices/phase-2-server-load-narrowing/projection-metric-and-bulk-read.md) -
  M5, L10, U1. Defer `jsonPayloadBytes` behind the metrics-enabled guard (thunk);
  load command-event history only when replay is requested; resolve bulk-hydration
  `knownChatIds` via a targeted `SELECT id ... WHERE id IN (...)` instead of full
  `loadPersisted`.

## Planned Shape

- The scoped loaders already exist (`getChatMessagesGroupedByIds`,
  `loadCharacterSelectionRows`); the work is wiring them on the hot paths and
  adding the memo, not new storage.
- Every non-target chat must still get `message=[]` so downstream `eachChat` /
  memo iteration does not regress; per-chat hypaV3 embedded-fallback semantics are
  preserved.
- Collection narrowing is safe (mutate callbacks never read a collection field);
  character/chat narrowing for message-only routes needs care because
  `normalizeAllCharacterChats` dedups chat/folder ids across all characters —
  keep that invariant (load all character rows but skip the message bodies, or
  re-validate dedup on the scoped set).

## Exit Criteria

- [ ] M1: prompt assembly hydrates only the active chat's messages/hypaV3; the
      server clone-cost assertion shows zero `getAllChatMessagesGrouped` calls on
      the assembly path; `loadPersistedWithMessages` is unchanged for its other
      consumers. Assembly output bytes identical.
- [ ] M3/L5/L6: a message/scriptstate/generation mutation parses only the tables
      it reads (asserted by a load-count test); revision/event/output unchanged;
      `normalizeAllCharacterChats` dedup still holds.
- [ ] M4: `loadSingleCharacterRow` performs a single-row read; the `characterRow`
      projection payload is byte-identical to before.
- [ ] M5: `jsonPayloadBytes` does not run when `RISU_PROTOCOL_METRICS` is off;
      metric output identical when on.
- [ ] L1/L2/L10/U1: each narrows its cited redundant load with no behavior change.
- [ ] Gates registered in Phase 8; full server suite + audit + TypeScript checks
      green.

## Validation

- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts`
  (M1, L1, L2 stage timings).
- `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test -- server/fastify/__tests__/commandMetrics.test.ts`
  (M3, L5, L6 mutation read cost).
- `pnpm api:test -- server/fastify/__tests__/projection.test.ts server/fastify/__tests__/bootstrap.test.ts`
  (M4, M5, L10, U1; payload identity).
- `pnpm api:test`, `pnpm client-thinning:audit`, both TypeScript checks.
