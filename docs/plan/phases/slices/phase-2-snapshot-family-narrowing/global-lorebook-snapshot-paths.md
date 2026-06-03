# Global-Lorebook Snapshot Paths

Status: implemented. Phase 2. Depends on the Phase 0
`currentGlobalLorebookStateSnapshot` and the existing `scopedLorebookStateSnapshot`.

Landed: `lorepreset.svelte` select/create/delete capture
`currentGlobalLorebookStateSnapshot()` instead of `currentLorebookStateSnapshot()`,
and `dispatchSelectGlobalLorebook` / `dispatchCreateGlobalLorebook` /
`dispatchDeleteGlobalLorebook` now take a `GlobalLorebookStateSnapshot` and roll back
via `restoreGlobalLorebookState` (only `loreBook` / `loreBookPage`, never the
characters + modules clone). The 6 `triggers.ts` v2 lorebook effects route through a
new `persistCharacterLorebookEdit(char, prevGlobalLore)` helper that captures the
entry list BEFORE the in-place edit and rolls back via
`scopedLorebookStateSnapshot('character:'+chaId, prevGlobalLore)` (one character's
`globalLore` only). The redundant `setCurrentCharacter(char)` re-clone is gone —
the helper writes back with `{ dispatchServerCommand: false }` (no character-row
snapshot, no character PATCH, which was always an empty no-op since `globalLore` is
excluded from character patches). Dropping `currentLorebookStateSnapshot()` from the
trigger path also removes its per-call `ensureAllClientLorebookIds()` full-tree walk
(the watcher still ensures ids once behind its `clientIdsInitialized` gate, and the
dispatch ensures entry ids itself).

Proof: `lorebookBridge.test.ts` "Phase 2 global-lorebook scoped dispatch" (a failed
`dispatchSelectGlobalLorebook` restores only the pointer, sibling character edit
survives) and `triggers.projectionGuard.test.ts` "Phase 2 trigger lorebook scoped
rollback" (a failed v2 lorebook trigger restores only the one character's
`globalLore`, sibling untouched). The 6 existing trigger guard tests still pass.

Out of scope (still hold the broad `currentLorebookStateSnapshot`): the LoreBook
sidebar panels, MCP risuaccess, and `lorebook.svelte.ts` / `modules.ts` callers.

## Scope

Replace full characters+modules rollback on global-lorebook and lorebook-trigger
paths with lorebook-only or single-character snapshots.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the High `lorepreset.svelte` finding and the High/Medium lorebook-trigger
  finding (shared snapshot function, two paths).
- `src/lib/Setting/lorepreset.svelte:28/60-66/91/119` - `selectLorebook` (per
  entry onclick; `canUseServerCommands()` unconditionally true so the server
  branch is live), the delete handler, the create handler.
- `src/ts/server/lorebookBridge.svelte.ts` - `currentLorebookStateSnapshot`,
  `currentGlobalLorebookStateSnapshot`, `restoreGlobalLorebookState`, scoped
  lorebook rollback, and the watcher id-initialization gate.
- `src/ts/process/triggers.ts` - the 6 v2 lorebook trigger effects and
  `persistCharacterLorebookEdit`.
- `src/ts/server/lorebookBridge.svelte.ts` - the existing
  `scopedLorebookStateSnapshot('character:'+chaId, prevGlobalLore)` /
  `restoreScopedLorebookState`.

## Implemented Shape

- `lorepreset.svelte` select/create/delete uses
  `currentGlobalLorebookStateSnapshot()` and dispatches that roll back only
  `loreBook` / `loreBookPage`.
- The 6 lorebook trigger sites capture the previous `globalLore` and persist via
  `persistCharacterLorebookEdit`, which rolls back a single character's lorebook.
- The redundant `setCurrentCharacter(char)` re-clone is gone, and lorebook id
  ensuring no longer walks the full tree per trigger call.

## Behavior / Invariants

- The dispatched commands (`dispatchSelectGlobalLorebook`,
  `dispatchReplaceCharacterLorebooks`) are unchanged; only the rollback baseline
  narrows.
- A failed select/create/delete restores only `loreBook`/`loreBookPage`; a failed
  lorebook trigger restores only that character's `globalLore`.
- Lorebook watcher/trigger ids are ensured once via the watcher init flag; global
  select/create/delete snapshots still call `ensureAllClientLorebookIds()` before
  dispatch.

## Proven

- Clone-cost coverage proves global-lorebook and trigger paths avoid the
  characters+modules clone.
- Rollback-correctness coverage proves failed select restores only the global
  pointer and failed trigger restores only one character's `globalLore`.

## Validation

- `pnpm test -- src/ts/server/lorebookBridge.test.ts src/ts/server/lorebookBridge.svelte.test.ts`
- `pnpm test -- src/ts/process/__tests__/triggers.projectionGuard.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
