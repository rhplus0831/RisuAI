# Global-Lorebook Snapshot Paths

Status: implemented. Phase 2. Depends on the Phase 0
`currentGlobalLorebookStateSnapshot` and the existing `scopedLorebookStateSnapshot`.

Implemented: global-lorebook select/create/delete uses
`currentGlobalLorebookStateSnapshot()` and rolls back only `loreBook` /
`loreBookPage`. The six v2 lorebook trigger effects persist through
`persistCharacterLorebookEdit`, capturing the previous `globalLore` and rolling
back one character's lorebook; the redundant character re-clone is gone. Proofs
live in `lorebookBridge.test.ts` and `triggers.projectionGuard.test.ts`. The
LoreBook sidebar panels, MCP risuaccess, and `lorebook.svelte.ts` / `modules.ts`
callers still hold the broad `currentLorebookStateSnapshot`.

## Scope

Replace full characters+modules rollback on global-lorebook and lorebook-trigger
paths with lorebook-only or single-character snapshots.

## Source Anchors

- [`../../../../../frontend-performance-audit.md`](../../../../../frontend-performance-audit.md) -
  the High `lorepreset.svelte` finding and the High/Medium lorebook-trigger
  finding (shared snapshot function, two paths).
- `src/lib/Setting/lorepreset.svelte` - `selectLorebook`, delete, and create
  handlers.
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
