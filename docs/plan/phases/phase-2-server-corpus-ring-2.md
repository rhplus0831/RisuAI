# Phase 2: Server Corpus-Path Ring 2 (Root 1)

Status: complete.

Goal: finish what v1 Phase 2 started — the second ring of server paths that
still parse, normalize, clone, or rewrite the whole corpus for single-row
work. Wire the existing scoped kit (`chatScopedRead`,
`loadPersistedForChatMutation`, single-row loaders, the writer kit) into the
missed callers.

Findings: M5, M6, L3, L13, L14, L16, K1, K2.

## Slices

- M5:
  [`slices/phase-2-server-corpus-ring-2/character-chat-patch-scoped-reads.md`](slices/phase-2-server-corpus-ring-2/character-chat-patch-scoped-reads.md)
  - narrow character/chat PATCH reads and repair to the target row.
- M6 + L16:
  [`slices/phase-2-server-corpus-ring-2/projection-field-scoped-loaders.md`](slices/phase-2-server-corpus-ring-2/projection-field-scoped-loaders.md)
  - field-scoped projection loaders plus single auth verification on bulk
    projection routes.
- L3:
  [`slices/phase-2-server-corpus-ring-2/server-intent-completion-settings-loader.md`](slices/phase-2-server-corpus-ring-2/server-intent-completion-settings-loader.md)
  - replace server-intent completion's full-corpus read with a settings-sized
    completion database.
- L13:
  [`slices/phase-2-server-corpus-ring-2/realm-import-targeted-character-append.md`](slices/phase-2-server-corpus-ring-2/realm-import-targeted-character-append.md)
  - persist Realm character append through targeted character/chat writers.
- K1:
  [`slices/phase-2-server-corpus-ring-2/generation-finalization-chat-scoped-read.md`](slices/phase-2-server-corpus-ring-2/generation-finalization-chat-scoped-read.md)
  - wire `chatScopedRead` into generation finalization when no chat variables
    are written.
- K2:
  [`slices/phase-2-server-corpus-ring-2/asset-gc-scoped-reference-scan.md`](slices/phase-2-server-corpus-ring-2/asset-gc-scoped-reference-scan.md)
  - remove asset-GC's full persisted corpus read while preserving orphan
    detection.
- L14:
  [`slices/phase-2-server-corpus-ring-2/message-diff-append-fast-path.md`](slices/phase-2-server-corpus-ring-2/message-diff-append-fast-path.md)
  - make append transcript persistence avoid O(N) prefix stringify work.
- Proof:
  [`slices/phase-2-server-corpus-ring-2/phase-2-verification-refresh.md`](slices/phase-2-server-corpus-ring-2/phase-2-verification-refresh.md)
  - refresh gates, focused proofs, full validation, and latest verification.

## Source Anchors

- [`../audit-stability-and-performance-v2.md`](../audit-stability-and-performance-v2.md) -
  M5, M6, L3, L13, L14, L16; K1/K2 under Known-Item Overlaps.
- M5: `server/fastify/src/routes/commands.ts` (character PATCH double
  `ensureCharacterCollection`; chat PATCH), `commands/characters.ts`
  (`repairCharacterRecord`), `commands/chats.ts`
  (`normalizeAllCharacterChats`).
- M6: `server/fastify/src/routes/projection.ts` (field branch),
  `repository.ts` (`loadPersistedDatabaseFields`,
  `loadStubbedProjectionFields`, `COLLECTION_TABLE_MAP`).
- L3: `server/fastify/src/routes/generation.ts`
  (`handleServerIntentCompletion`).
- L13: `server/fastify/src/routes/realmImport.ts` (`appendRealmCharacter`).
- L14: `server/fastify/src/messageStore.ts` (`replaceActiveChatMessages`,
  `applyChatMessageDiff`, `stableEqual`).
- L16: `server/fastify/src/routes/projection.ts` (bulk routes' double
  `requireAuth`).
- K1: `server/fastify/src/routes/generationChat.ts`
  (`persistServerGenerationResult` -> `applyTargetedCommandMutation` without
  `chatScopedRead`).
- K2: `server/fastify/src/assetGc.ts` (`runAssetGc` -> `loadPersisted`).

## Planned Shape

- M5 needs a modules-aware scoped read: the chat PATCH validates
  `patch.modules` via `ensureModuleRecords`/`validateNormalModuleLinks`, so
  either extend the scoped read to carry modules or fall back to broad only
  when `patch.modules` is present. The duplicate repair pass on character
  PATCH collapses into a single-row repair.
- M6 mirrors `loadSingleCharacterStubRow`: parse only the tables behind the
  requested `fieldKeys`; skip `loadCharactersFromSqlite` unless `characters`
  is requested.
- K1 is wiring, not new machinery: pass `chatScopedRead` on the finalization
  persist, keeping the broad read for the var-write case (v1-L4 stays
  gated).
- K2 reuses the message-free/scoped loaders for the GC's non-message
  references; the Phase 5 (v1) token scan already covers messages.
- L14: compare lengths + tail for the append case (or per-row fingerprints)
  instead of stringifying the unchanged prefix; byte-identical persisted
  rows.

## Exit Criteria

- [x] M5: character/chat PATCH parse + repair only the target row (load-count
      assertion), modules validation preserved; persisted rows and events
      byte-identical.
- [x] M6: a foreign `preset`/`plugin`/`moduleEnabled` field projection
      performs zero characters-table reads; payload byte-identical.
- [x] L3/L13/K1/K2: each cited path shows zero whole-corpus loads on the
      load-count harness, with output identity tests.
- [x] L14: appending one message to an N-message chat performs O(1) prefix
      comparisons; delete/truncate paths unchanged.
- [x] L16: bulk routes verify auth exactly once; 401 behavior unchanged.
- [x] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/serverLoadCostHarness.test.ts \
  server/fastify/__tests__/commandMutationReadNarrowing.test.ts \
  server/fastify/__tests__/projection.test.ts \
  server/fastify/__tests__/assetGc.test.ts
RISU_COMMAND_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/commandMetrics.test.ts
pnpm api:test
```
