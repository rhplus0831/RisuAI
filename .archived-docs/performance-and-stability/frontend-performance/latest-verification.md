# Latest Verification

Date: 2026-06-04

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime under test: Phase 7 (opportunistic cleanups, all eight items) and Phase
  8 (clone-cost gate completeness self-check), on top of Phases 0-6.
- Phase 7 clone-range changes (all output/behavior preserving):
  - CBS history (`cbs.ts`): per-message deep clone → shallow spread; before = one
    `safeStructuredClone` per rendered history message, after = one `{ ...v }`.
  - Claude observer (`observer.svelte.ts`): full request-body deep clone → shallow
    spread.
  - Image/emotion (`characters.ts`): before = whole `characters` array clone +
    full target-character clone per action; after = a single
    `currentCharacterRowSnapshot` row clone, rolled back via
    `dispatchCompatibleCharacterUpdateScoped`.
  - Regex scripts (`scripts.ts`): per-token `new RegExp` recompile → memoized
    (capped 1000, `lastIndex` reset on retrieval).
  - `{{#each}}` (`risuChatParser.ts`): whole-source re-splice (O(da.length),
    compounding for nested each) → drop the consumed prefix and reset the pointer
    (O(remaining)).
  - Render logs (`ChatBody.svelte`): removed two per-`<img>` `console.log`s,
    including the full-assets serialization.
  - `SideChatList`: before = `chats.filter(...)` twice per folder + `indexOf` per
    chat (O(folders*chats)+O(chats^2)); after = one `groupChatsByFolderId` pass.
  - `PersonaSettings`: two whole-personas clones per keystroke → one reused
    snapshot.
- Phase 8: `cloneCostGateCompleteness.test.ts` registers every Critical/High
  narrowed path with its clone-cost + rollback gates and fails on drift
  (verified: an unregistered harness-importing test breaks the self-check).
- Result: green. The new gates are CBS history, image/emotion clone-cost +
  rollback, regex-cache, `{{#each}}` re-injection, `chatFolderGrouping`, and the
  Phase 8 self-check; the Phase 0-6 proofs are unchanged.

| Command                                                                                     | Result                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                 | green - 1054 passed / 4 skipped (112 files).                                                                |
| `pnpm api:test`                                                                             | green - 1632 passed / 1 skipped (93 files).                                                                 |
| `pnpm client-thinning:audit`                                                                | green - audit passed.                                                                                       |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | green - both zero errors (clean client-lib rebuild required: remove `dist/client-types` AND `tsconfig.client-lib.tsbuildinfo` if TS6305 appears). |
| `pnpm check` (svelte-check)                                                                  | 10 pre-existing errors in 5 files outside this workstream (unchanged baseline); the Phase 7 files add none. |

## Notes

- The Phase 0 kit generalizes the reference proof pattern for clone-cost and
  rollback-scope regressions.
- Phase 8 keeps the clone-cost gate map self-checking: each narrowed hot path
  should have a proof that it avoids whole-`Database` / whole-characters clone
  primitives, and new slices should add that proof before being marked
  implemented.
- The guard fix (Phase 1) is verified by a guarded one-field write staying O(1)
  on a multi-chat hydrated DB (no full-DB clone) while Svelte reactivity still
  fires and readers still receive a read-only projection.
- Refresh this file after any new focused or full verification run, recording the
  before/after clone range (the analog of the mutation-range plan's
  before/after written-table set) for the slice under test.
