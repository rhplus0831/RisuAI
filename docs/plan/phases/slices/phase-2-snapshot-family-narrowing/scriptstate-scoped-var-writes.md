# Scriptstate-Scoped Var Writes

Status: planned. Phase 2. Depends on the Phase 0 `ChatScriptstateSnapshot`.

## Scope

Replace the full-characters `currentChatStateSnapshot()` rollback baseline on the
single-key scriptstate / author-note writes with a scriptstate-scoped snapshot, so
a `{{setvar}}` / trigger var write / author-note update clones only the active
chat's `scriptstate` map (+ a scalar) rather than every character's hydrated
history.

## Source Anchors

- [`../../../../frontend-performance-audit.md`](../../../../frontend-performance-audit.md) -
  the Medium/High `setVar`, `setChatVar`, and `v2SetAuthorNote` findings.
- `src/ts/process/triggers.ts:1344` - the `setVar` closure
  (`currentChatStateSnapshot()` → single `scriptstate` key); short-circuits before
  the clone for `displayMode` and local vars.
- `src/ts/process/triggers.ts:3081` - `v2SetAuthorNote`
  (`currentChatStateSnapshot()` → single `chat.note`).
- `src/ts/parser/chatVar.svelte.ts:36` - `setChatVar`
  (`currentChatStateSnapshot()` → single `scriptstate` key); fires only when
  `matcherArg.runVar === true` (per-send `runSendChatMessageVariables`).
- `src/ts/process/command.ts:200/219` (and `:213/234`) - `/setvar`/`/addvar`
  scriptstate writes.

## Target Implementation

- Route all of these through `currentChatScriptstateSnapshot()` /
  `restoreChatScriptstate()` (Phase 0): `{ chatId, selectedCharID, scriptstate:
  shallowClone(chat.scriptstate) }`, restoring only that chat's `scriptstate` by
  id on failure. For `v2SetAuthorNote`, extend the snapshot with the `note` scalar
  and the prior value.
- Hoist a single `ChatScriptstateSnapshot` to the start of the `runTrigger` pass
  and reuse it across all `setVar` calls in that pass (`setVar` can fire many
  times per pass, one per non-local `v2SetVar`/array/dict/regex effect).
- `setChatVar` keeps its existing `runVar` short-circuit; only the snapshot
  source changes.

## Behavior / Invariants

- The short-circuits stay: `displayMode`/local-var (`setVar`) and `runVar:false`
  (`setChatVar`) paths still never reach the snapshot.
- The dispatched patch (`dispatchPatchChatScriptstate` /
  `dispatchCurrentChatScriptstatePatch` / `dispatchUpdateChat` for the note) is
  unchanged; only the rollback baseline narrows.
- A failed scriptstate/note patch restores only that chat's `scriptstate`/`note`,
  not the whole array.

## Done When

- `setVar`, `setChatVar`, `/setvar`, `/addvar`, and `v2SetAuthorNote` capture a
  scriptstate-scoped (or note-scalar) snapshot; none clones every character
  (clone-cost harness).
- One snapshot is reused across a multi-`setVar` `runTrigger` pass.
- Rollback-correctness tests prove a failed var/note write restores only the
  target chat's scriptstate/note.
- `pnpm test` and `pnpm client-thinning:audit` are green.

## Validation

- `pnpm test -- src/ts/process/triggers` and `pnpm test -- src/ts/parser/chatVar`
- `pnpm test`
- `pnpm client-thinning:audit`
