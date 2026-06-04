# Latest Verification

Date: 2026-06-04

This file holds the latest verification result for this workstream. Replace the
latest-run section on each full or focused run; do not append history.

## Latest Run

- Runtime under test: Phase 6 (`c6dd103c`) on top of Phases 0-5.
- Before: every lorebook reactive fire rebuilt a DB-wide stringify map — every
  global lorebook, every character's globalLore, every chat of every character,
  and every module — regardless of which panel was mounted.
- After: `watchServerBackedLorebooks` takes a `LorebookWatchScope`
  (`all | global | character | module`); each panel passes its own, so a fire
  scans only that collection. The `all` default is the unchanged whole-DB scan.
  The `character` scope re-subscribes on a character switch via
  `selectedCharMirror`; the hydrated-character no-data-loss invariant is intact.
- Result: green. `lorebookBridge.svelte.test.ts` proves each scope collects only
  its panel's keys, `all` still scans the whole DB, a scoped fire performs far
  fewer snapshot clones (`withCloneInstrumentation`), and a character-scoped
  watcher ignores cross-scope edits while re-subscribing after a switch.

| Command                                                                                     | Result                                                                                                      |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                                                                 | green - 1022 passed / 4 skipped (106 files).                                                                |
| `pnpm api:test`                                                                             | green - 1632 passed / 1 skipped (93 files).                                                                 |
| `pnpm client-thinning:audit`                                                                | green - audit passed.                                                                                       |
| Type check (`tsconfig.client-lib.json` build, then `server/fastify/tsconfig.json --noEmit`) | green - both zero errors (clean client-lib rebuild required: remove `dist/client-types` AND `tsconfig.client-lib.tsbuildinfo` if TS6305 appears). |
| `pnpm check` (svelte-check)                                                                  | 10 pre-existing errors in 5 files outside this workstream (unchanged baseline); the Phase 6 files add none. |

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
