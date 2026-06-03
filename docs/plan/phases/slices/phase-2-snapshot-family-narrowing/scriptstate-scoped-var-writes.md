# Scriptstate-Scoped Var Writes

Status: implemented. Phase 2. Depends on the Phase 0 `ChatScriptstateSnapshot`.

Landed: single-key scriptstate and author-note writes capture
`currentChatScriptstateSnapshot()` instead of `currentChatStateSnapshot()`. New
scoped dispatchers (sharing the broad cores): `dispatchPatchChatScriptstateScoped`
and `dispatchUpdateChatNoteScoped`, both rolling back via `restoreChatScriptstate`
(scriptstate map + optional note, never the characters array);
`dispatchCurrentChatScriptstatePatch` now takes a `ChatScriptstateSnapshot`. In
`runTrigger`, a lazy-memoized `captureScriptstateRollback()` mints one snapshot
per pass (captured on the first `setVar`/`v2SetAuthorNote`, reused after, free on
display passes) — `setVar` → `dispatchPatchChatScriptstateScoped`,
`v2SetAuthorNote` → `dispatchUpdateChatNoteScoped`. `chatVar.svelte.ts::setChatVar`
and `command.ts` `/setvar`/`/addvar` also narrowed. Proof: scoped scriptstate +
note failure-rollback tests in `chatCommands.test.ts`.

## Scope

Replace full-characters rollback on single-key scriptstate and author-note writes
with a scriptstate-scoped snapshot. These paths should clone only the active
chat's `scriptstate` map plus optional `note`.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Medium/High `setVar`, `setChatVar`, and `v2SetAuthorNote` findings.
- `src/ts/process/triggers.ts:1344` - the `setVar` closure
  (`currentChatStateSnapshot()` -> single `scriptstate` key); short-circuits before
  the clone for `displayMode` and local vars.
- `src/ts/process/triggers.ts:3081` - `v2SetAuthorNote`
  (`currentChatStateSnapshot()` -> single `chat.note`).
- `src/ts/parser/chatVar.svelte.ts:36` - `setChatVar`
  (`currentChatStateSnapshot()` -> single `scriptstate` key); fires only when
  `matcherArg.runVar === true` (per-send `runSendChatMessageVariables`).
- `src/ts/process/command.ts:200/219` (and `:213/234`) - `/setvar`/`/addvar`
  scriptstate writes.

## Implemented Shape

- `setVar`, `setChatVar`, `/setvar`, `/addvar`, and `v2SetAuthorNote` use
  `currentChatScriptstateSnapshot()` / `restoreChatScriptstate()`.
- Scoped dispatch helpers sit beside the broad chat helpers and restore only the
  scriptstate map plus optional `note`.
- `runTrigger` lazily captures one `ChatScriptstateSnapshot` per pass and reuses
  it across every non-local var/note write; display/local-var short-circuits are
  unchanged.

## Behavior / Invariants

- Keep the existing short-circuits for `displayMode`, local vars, and
  `runVar:false`.
- The dispatched patch (`dispatchPatchChatScriptstate` /
  `dispatchCurrentChatScriptstatePatch` / `dispatchUpdateChat` for the note) is
  unchanged; only the rollback baseline narrows.
- A failed scriptstate/note patch restores only that chat's `scriptstate`/`note`,
  not the whole array.

## Proven

- Clone-cost tests cover the scriptstate/note paths and the one-snapshot-per-pass
  `runTrigger` behavior.
- Rollback-correctness tests prove a failed var/note write restores only the
  target chat's scriptstate/note.

## Validation

- `pnpm test -- src/ts/process/__tests__/triggers.projectionGuard.test.ts src/ts/parser/tests/chatVar.svelte.test.ts`
- `pnpm test`
- `pnpm client-thinning:audit`
