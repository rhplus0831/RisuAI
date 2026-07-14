# Phase 4: Client Clone Narrowing Ring 2 (Root 3)

Status: complete; proof refreshed on 2026-06-06. Independent of Phases 5-8.

Goal: the second ring of client whole-corpus clones. Two of the four mediums
are one-line fixes (M7, M8); the rest mirror landed v1 shapes.

Findings: M7, M8, M9, M10, L32, L33, L34, L37, K4.

## Slices

- M7:
  [`slices/phase-4-client-clone-ring-2/replace-all-message-patch-no-clone.md`](slices/phase-4-client-clone-ring-2/replace-all-message-patch-no-clone.md)
  - assign private `replace_all` message arrays without recloning the
    transcript.
- M8:
  [`slices/phase-4-client-clone-ring-2/plugin-storage-key-read-snapshot.md`](slices/phase-4-client-clone-ring-2/plugin-storage-key-read-snapshot.md)
  - read and detach one plugin storage key instead of snapshotting the whole
    database.
- M9:
  [`slices/phase-4-client-clone-ring-2/chat-metadata-allowed-key-diff.md`](slices/phase-4-client-clone-ring-2/chat-metadata-allowed-key-diff.md)
  - diff only allowed chat metadata keys and clone only changed values.
- M10:
  [`slices/phase-4-client-clone-ring-2/module-command-snapshot-narrowing.md`](slices/phase-4-client-clone-ring-2/module-command-snapshot-narrowing.md)
  - split global module and character-module rollback snapshots.
- L32:
  [`slices/phase-4-client-clone-ring-2/send-family-targeted-chat-mutations.md`](slices/phase-4-client-clone-ring-2/send-family-targeted-chat-mutations.md)
  - remove remaining `setDatabase` normalizer calls from send-family slash
    command message edits.
- L33:
  [`slices/phase-4-client-clone-ring-2/remove-char-trash-single-row.md`](slices/phase-4-client-clone-ring-2/remove-char-trash-single-row.md)
  - make trash removal capture only the targeted character row.
- L34:
  [`slices/phase-4-client-clone-ring-2/select-supa-memory-flag-patch.md`](slices/phase-4-client-clone-ring-2/select-supa-memory-flag-patch.md)
  - patch only `supaMemory` when selection auto-enables Hypa V3 memory.
- L37:
  [`slices/phase-4-client-clone-ring-2/language-change-same-code-cache.md`](slices/phase-4-client-clone-ring-2/language-change-same-code-cache.md)
  - early-return when `changeLanguage` receives the already-applied language
    code.
- K4:
  [`slices/phase-4-client-clone-ring-2/lorebook-editor-keystroke-scope.md`](slices/phase-4-client-clone-ring-2/lorebook-editor-keystroke-scope.md)
  - debounce or scope lorebook entry typing so it no longer clones the whole
    collection per keystroke.
- Proof:
  [`slices/phase-4-client-clone-ring-2/phase-4-verification-refresh.md`](slices/phase-4-client-clone-ring-2/phase-4-verification-refresh.md)
  - refresh gates, focused proofs, full validation, and latest verification.

## Source Anchors

- [`../audit-stability-and-performance-v2.md`](../audit-stability-and-performance-v2.md) -
  M7-M10, L32-L34, L37; K4 under Known-Item Overlaps.
- M7: `src/ts/process/request/serverMessagePatch.ts` (`replace_all`
  `structuredClone` of an already-private array).
- M8: `src/ts/plugins/plugins.svelte.ts` (`pluginStorage.getItem` whole-DB
  snapshot; siblings `key`/`keys`/`length` are already non-snapshot).
- M9: `src/ts/chatCommands.ts` (`changedChatMetadata`); shape precedent
  `changedCharacterFields` (v1 M13).
- M10: `src/ts/moduleCommands.ts` (`currentModuleStateSnapshot`); also
  callers in `plugins.svelte.ts` and `process/mcp/risuaccess/modules.ts`;
  the character-module paths need only a single-row/field snapshot.
- L32: `src/ts/process/command.ts` (`sendmessage`,
  `mutateCurrentChatMessages` still call `setDatabase`); v1 M12 explicitly
  deferred these — assess their broader message semantics per call site.
- L33: `src/ts/characters.ts` (`removeChar` trash branch).
- L34: `src/ts/stores.svelte.ts` (`selectedCharID.subscribe` hypaV3
  `alwaysToggleOn` write).
- L37: `src/lang/index.ts` (`changeLanguage` same-language early-return).
- K4: `src/lib/SideBars/LoreBook/LoreBookList.svelte` +
  `LoreBookData.svelte` (per-keystroke collection clone; v1-L32 scoped only
  the watcher).

## Landed Shape

- M7: assign `mutation.messages` directly (it is a private deserialized
  array); add a clone-count assertion on the patch-apply path. The
  longer-term incremental-mutation protocol change is NOT in this phase.
- M9 mirrors the v1 M13 diff: iterate `CHAT_PATCH_ALLOWED_KEYS` over the raw
  records, clone only changed allowed values.
- M10 splits the snapshot: module-only for the global commands (whose server
  branch performs no optimistic write at all), single-row for the
  character-module paths.
- L37 is a one-line cache of the last applied language code; it also halves
  the residual `setDatabase` cost everywhere pending L32.
- Rollback correctness is the invariant to test: every narrowed snapshot
  needs a forced-failure test proving the rollback restores exactly the
  mutated fields.

## Exit Criteria

- [x] M7: zero `structuredClone` calls per `replace_all` apply (counting
      assertion); applied transcript identical.
- [x] M8: `getItem` performs zero whole-DB snapshots; returned values still
      detached from live state.
- [x] M9/M10/L33/L34: clone-cost assertions show single-row/module-only
      capture; forced-failure rollbacks restore exactly the mutated fields.
- [x] L32: the deferred command paths drop `setDatabase` with per-command
      behavior tests (or are explicitly re-gated with a documented reason).
- [x] L37: `changeLanguage` early-returns on an unchanged language; language
      switching still works.
- [x] K4: lorebook entry typing no longer clones the collection per
      keystroke (debounced/scoped), server writes unchanged after settle.
- [x] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Proof Refresh

Recorded in [`../latest-verification.md`](../latest-verification.md) on
2026-06-06:

- Phase 4 focused clone/rollback suites passed: 9 files / 131 tests.
- Supplemental module/compatibility suites passed: 3 files / 29 tests.
- v2 and clone-cost gates passed: 2 files / 27 tests.
- `pnpm test` passed: 126 files; 1202 passed / 4 skipped. The run printed the
  pre-existing local-service `ECONNREFUSED 127.0.0.1:3000` probe noise but
  exited 0.
- `pnpm api:test` passed: 99 files; 1792 passed / 1 skipped.
- `pnpm client-thinning:audit` passed.
- `pnpm exec tsc -p tsconfig.client-lib.json` and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit` passed with zero
  diagnostics.

## Validation

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/moduleCommands.test.ts
pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/commands.test.ts
pnpm exec vitest run src/ts/process/__tests__/command.projectionGuard.test.ts
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
