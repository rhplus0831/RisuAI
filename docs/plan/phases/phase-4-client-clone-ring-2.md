# Phase 4: Client Clone Narrowing Ring 2 (Root 3)

Status: pending. Independent of Phases 5-8; order by pain.

Goal: the second ring of client whole-corpus clones. Two of the four mediums
are one-line fixes (M7, M8); the rest mirror landed v1 shapes.

Findings: M7, M8, M9, M10, L32, L33, L34, L37, K4.

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

## Planned Shape

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

- [ ] M7: zero `structuredClone` calls per `replace_all` apply (counting
      assertion); applied transcript identical.
- [ ] M8: `getItem` performs zero whole-DB snapshots; returned values still
      detached from live state.
- [ ] M9/M10/L33/L34: clone-cost assertions show single-row/module-only
      capture; forced-failure rollbacks restore exactly the mutated fields.
- [ ] L32: the deferred command paths drop `setDatabase` with per-command
      behavior tests (or are explicitly re-gated with a documented reason).
- [ ] L37: `changeLanguage` early-returns on an unchanged language; language
      switching still works.
- [ ] K4: lorebook entry typing no longer clones the collection per
      keystroke (debounced/scoped), server writes unchanged after settle.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/characterCommands.test.ts src/ts/moduleCommands.test.ts
pnpm exec vitest run src/ts/server/lorebookBridge.svelte.test.ts src/ts/server/commands.test.ts
pnpm exec vitest run src/ts/process/__tests__/command.projectionGuard.test.ts
pnpm test && pnpm client-thinning:audit
```
