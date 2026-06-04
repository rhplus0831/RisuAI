# Latest Verification

Date: 2026-06-04

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime/code change under test: Phase 4 script-definition watcher scoped
  rollback (`2ec1ea40`) on top of Phases 0-3.
- Before/after clone range: BEFORE = `watchServerBackedScriptDefinitions` called
  `currentScriptDefinitionStateSnapshot()` on every effect fire (and at watcher
  setup), deep-cloning the whole `DBState.db.characters` + `modules` graph
  (hydrated message histories included) for a rollback baseline. AFTER = the
  per-key scripts/triggers stringify map (`collectScriptDefinitionCollectionSnapshots`)
  is the only change-detection input and the only per-fire serialization; the
  rollback is parsed lazily from the prior per-key snapshot string into a
  single-row `ScopedScriptDefinitionRollback` inside `dispatchWatchedReplacement`.
- Guard-safety note: scoped restore (`restoreScopedScriptDefinition`) runs inside
  `withTrustedServerProjectionWrite`, finds the row by id, and writes only that
  row's `customscript`/`triggerscript` (or module `regex`/`trigger`). The discrete
  full-snapshot callers (`modules.ts`, MCP) keep the broad
  `restoreScriptDefinitionState` via the `ScriptDefinitionRollback` union, which
  `rollbackServerBackedScriptDefinitions` discriminates on `'kind'`.
- Result: green. Proofs added in `scriptDefinitionBridge.svelte.test.ts`: three
  clone-cost tests (baseline, script edit, and streaming-token append all keep
  `maxClonedSize` below the ~250 KB hydrated history) and two scoped-rollback
  tests (a failed character/module replacement leaves unrelated rows untouched,
  which a whole-characters restore would clobber). The existing baseline tests are
  unchanged.

| Command                                                                                     | Result                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                 | green - 1008 passed / 4 skipped (105 files).                                                                |
| `pnpm api:test`                                                                             | green - 1632 passed / 1 skipped (93 files).                                                                 |
| `pnpm client-thinning:audit`                                                                | green - audit passed.                                                                                       |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | green - both zero errors (clean client-lib rebuild required: remove `dist/client-types` if TS6305 appears). |

## Notes

- The proof template is `src/ts/compatibilityAdapters.test.ts`: snapshot omits
  `characters`, and failed commands roll back only the mutated slice. Phase 0
  turns this into a reusable helper.
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
