# Global-Lorebook Snapshot Paths

Status: planned. Phase 2. Depends on the Phase 0
`currentGlobalLorebookStateSnapshot` and the existing `scopedLorebookStateSnapshot`.

## Scope

Replace the full characters + modules `currentLorebookStateSnapshot()` rollback
baseline on the global-lorebook select/create/delete path and the lorebook-trigger
path with narrow lorebook-only / single-character snapshots, since neither
operation broadly touches characters or modules.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the High `lorepreset.svelte` finding and the High/Medium lorebook-trigger
  finding (shared snapshot function, two paths).
- `src/lib/Setting/lorepreset.svelte:28/60-66/91/119` - `selectLorebook` (per
  entry onclick; `canUseServerCommands()` unconditionally true so the server
  branch is live), the delete handler, the create handler.
- `src/ts/server/lorebookBridge.svelte.ts:94` - `currentLorebookStateSnapshot`
  (clones `loreBook` + `characters` + `modules`); `ensureAllClientLorebookIds()`
  (walks every char/chat/module).
- `src/ts/process/triggers.ts:2211/2261/2931/2988/3011/3042` - the v2 lorebook
  trigger effects (modify / activate / create / modify-by-index / delete /
  always-active), each followed by `setCurrentCharacter(char)` (a second
  full-array clone).
- `src/ts/server/lorebookBridge.svelte.ts` - the existing
  `scopedLorebookStateSnapshot('character:'+chaId, prevGlobalLore)` /
  `restoreScopedLorebookState`.

## Target Implementation

- `selectLorebook` / delete / create: use `currentGlobalLorebookStateSnapshot()`
  (Phase 0) returning `{ loreBook, loreBookPage, selectedCharID }` with
  characters/modules omitted, restored by `restoreGlobalLorebookState` (only
  `loreBook` + `loreBookPage`). The select command only POSTs `{ baseRevision }`,
  so this rollback is sufficient.
- The 6 lorebook trigger sites: capture `globalLore` BEFORE the in-place edit via
  `scopedLorebookStateSnapshot('character:'+char.chaId, prevGlobalLore)` (handled
  by `restoreScopedLorebookState` without touching characters/modules/messages);
  export a small `characterLorebookRollbackSnapshot(chaId, previousGlobalLore)`
  helper if it reads cleaner. Drop the redundant `setCurrentCharacter(char)` (or
  use a no-snapshot variant) since the per-character `globalLore` replacement is
  already dispatched.
- Gate `ensureAllClientLorebookIds()` behind an init flag instead of running the
  full-tree walk per trigger call.

## Behavior / Invariants

- The dispatched commands (`dispatchSelectGlobalLorebook`,
  `dispatchReplaceCharacterLorebooks`) are unchanged; only the rollback baseline
  narrows.
- A failed select/create/delete restores only `loreBook`/`loreBookPage`; a failed
  lorebook trigger restores only that character's `globalLore`.
- Lorebook ids are still ensured (once, via the init flag) — no id-minting
  regression.

## Done When

- `selectLorebook` and the 6 trigger sites capture a lorebook-only / single-
  character snapshot; none clones every character or every module (clone-cost
  harness).
- The redundant `setCurrentCharacter` re-clone is removed from the trigger path.
- `ensureAllClientLorebookIds()` no longer walks the full tree per trigger call.
- Rollback-correctness tests prove a failed select restores only the lorebook
  pointer and a failed trigger restores only the one character's `globalLore`.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/server/lorebookBridge` and `pnpm test -- src/ts/process/triggers`
- `pnpm test`
- `pnpm client-thinning:audit`
