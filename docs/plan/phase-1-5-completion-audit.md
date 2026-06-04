# Phase 1-5 Completion Audit

Date: 2026-06-04

This audit checked whether Phases 1 through 5 were actually complete against the
runtime code and proof tests, not just against phase status labels. It used five
read-only subagents, one per phase, plus a coordinating source pass. No files
were modified during the audit pass and no test commands were run, because the
requested audit was read-only and Vitest/Vite/TypeScript commands can write cache
or build artifacts.

The audit was written after `afc47ae4` landed the Phase 6 documentation update.
Phase 6 is not re-audited here except as current-context drift: the findings
below cover Phases 1-5.

## Result

| Phase | Audit Status | Notes |
| --- | --- | --- |
| Phase 1: Projection Write Guard | Complete | Primary copy-on-write guard slice is implemented and covered. Optional batching remains deferred by design. |
| Phase 2: Snapshot-Family Hot-Path Narrowing | Complete | All six listed hot-path families use scoped snapshots/rollbacks; broad snapshots remain for restructures and deferred low-frequency callers. |
| Phase 3: Cheap High-Confidence Wins | Complete | Reroll tail/transcript wins and `runTrigger` early/lazy clone behavior are implemented and covered. |
| Phase 4: Script-Definition Watcher | Partial | Main clone reduction landed, but a debounced rollback baseline edge can restore to the wrong value after rapid edits. |
| Phase 5: Prompt-Template Editor Keystroke Costs | Complete | Single-item projection write, single-item rollback, and revision-gated reconcile are implemented. Debounce coalescing remains deferred by design. |

## Blocking Finding

### Phase 4 Debounced Rollback Baseline Can Drift

`watchServerBackedScriptDefinitions` no longer calls
`currentScriptDefinitionStateSnapshot()` on each watcher fire, and it now builds
scoped rollbacks from the per-key previous snapshot. That satisfies the phase's
main clone-cost goal.

However, the debounced command path preserves an original `previous` value in the
pending object but does not use that preserved value when the command eventually
rolls back:

- `dispatchReplaceCharacterScripts`, `dispatchReplaceCharacterTriggers`,
  `dispatchReplaceModuleScripts`, and `dispatchReplaceModuleTriggers` create
  command closures whose rollback calls
  `rollbackServerBackedScriptDefinitions(previous)` with the latest dispatch's
  closure variable:
  `src/ts/server/scriptDefinitionBridge.svelte.ts:155`,
  `:180`, `:205`, `:230`.
- `queueReplacement()` stores `previous: existing?.previous ?? previous`, which
  appears intended to keep the first baseline across debounce coalescing:
  `src/ts/server/scriptDefinitionBridge.svelte.ts:364-383`.
- The timer executes `pending.command()` instead of a command rebuilt from
  `pending.previous`: `src/ts/server/scriptDefinitionBridge.svelte.ts:381`.

Expected behavior for rapid edits A then B before the debounce fires:

1. The pending command should send B as the final replacement.
2. If the server command fails, rollback should restore the pre-A baseline.

Actual risk:

1. The final command sends B.
2. Its rollback closure can restore to A, because the closure captured the latest
   dispatch's `previous` value rather than the preserved `pending.previous`.

That violates the plan invariant that a narrowed rollback restores exactly the
mutated slice to the original failed-command baseline. Until this is fixed and
covered by a regression test, Phase 4 should be treated as partially complete:
clone-cost exit criteria are met, but rollback-correctness completion is not.

Recommended proof:

- Add a Phase 4 test that edits the same character script (or module trigger)
  twice within the debounce window, forces the command to fail, and asserts the
  row rolls back to the pre-first-edit value, not the intermediate value.
- Keep the existing clone-cost tests for baseline capture, script edit, and
  streaming message append.

## Phase Evidence

### Phase 1

Status: complete.

Evidence:

- `withTrustedServerProjectionWrite` swaps in a writable pass-through working
  proxy at depth 1 and refreezes at outer exit:
  `src/ts/server/projectionWriteGuard.svelte.ts:29`.
- `createReadOnlyServerProjection` mints a fresh read-only proxy tree with a
  per-wrap memo: `src/ts/server/projectionWriteGuard.svelte.ts:86`.
- Normal source resolution uses WeakMap unwraps; `$state.snapshot` remains only
  for rare raw/full-replacement fallback:
  `src/ts/server/projectionWriteGuard.svelte.ts:153`.
- Proof tests cover zero whole-Database clone, read-only refreeze, fresh identity,
  nested writes, full replacement, and immediate optimistic readback:
  `src/ts/server/projectionWriteGuard.test.ts:21`.

Residual caveats:

- Optional batching is explicitly deferred.
- The test suite proves observable reactivity, but does not directly assert every
  nested proxy identity changes.

### Phase 2

Status: complete.

Evidence:

- Chat metadata watcher builds scalar chat/folder maps and captures lazy row
  rollback: `src/ts/server/chatBridge.svelte.ts:70`,
  `src/ts/server/chatBridge.svelte.ts:101`,
  `src/ts/server/chatBridge.svelte.ts:212`.
- Chat-scoped message helpers and dispatches are present:
  `src/ts/chatCommands.ts:101`, `src/ts/chatCommands.ts:740`,
  `src/ts/chatCommands.ts:763`, `src/ts/chatCommands.ts:791`,
  `src/ts/chatCommands.ts:826`.
- Scriptstate scoped snapshot/dispatch is present:
  `src/ts/chatCommands.ts:135`, `src/ts/chatCommands.ts:867`,
  `src/ts/chatCommands.ts:891`.
- Reroll/swipe rollback captures `currentChatScopedSnapshot()`:
  `src/ts/process/rerollNavigation.svelte.ts:86`,
  `src/ts/process/rerollNavigation.svelte.ts:99`,
  `src/ts/process/rerollNavigation.svelte.ts:129`.
- Character-row snapshot and scoped dispatch are present:
  `src/ts/characterCommands.ts:111`, `src/ts/characterCommands.ts:256`;
  `setCurrentCharacter` and `setCharacterByIndex` use them:
  `src/ts/storage/database.svelte.ts:960`,
  `src/ts/storage/database.svelte.ts:993`.
- Global-lorebook select/create/delete use `GlobalLorebookStateSnapshot`, and
  trigger lorebook mutations use scoped lorebook rollback:
  `src/ts/server/lorebookBridge.svelte.ts:159`,
  `src/ts/process/triggers.ts:1189`.

Residual caveats:

- Broad snapshots intentionally remain for create/delete/reorder/fork and
  deferred lower-frequency callers.
- Global-lorebook failure coverage directly exercises select; create/delete use
  the same rollback helper but are not separately exercised in the audit.

### Phase 3

Status: complete.

Evidence:

- `recordGeneratedReroll` clones only the generated tail:
  `src/ts/process/rerollNavigation.svelte.ts:60`.
- `applyTailSlice` mints ids inside the guard and passes rows by reference to
  scoped replace dispatch:
  `src/ts/process/rerollNavigation.svelte.ts:99`.
- Regenerate truncates the live transcript in place:
  `src/ts/process/rerollNavigation.svelte.ts:129`.
- `runTrigger` resolves triggers before clone work and returns early for no
  triggers: `src/ts/process/triggers.ts:1224`.
- Trigger-bearing paths clone the active chat eagerly and materialize the whole
  character only when a durable character/lorebook mutation needs it:
  `src/ts/process/triggers.ts:1262`,
  `src/ts/process/triggers.ts:1273`.
- The setVar guard follow-up routes scriptstate sync through a trusted write:
  `src/ts/process/triggers.ts:1388`.

Residual caveats:

- Exact reroll replace-message request bytes are covered indirectly by command
  serialization, not by a Phase 3-specific request-body assertion.

### Phase 4

Status: partial.

Evidence that the clone-cost slice landed:

- The full snapshot helper still exists for discrete callers, but the watcher
  uses `collectScriptDefinitionCollectionSnapshots()` instead:
  `src/ts/server/scriptDefinitionBridge.svelte.ts:236`,
  `src/ts/server/scriptDefinitionBridge.svelte.ts:339`.
- `dispatchWatchedReplacement()` builds scoped rollback objects from the previous
  per-key snapshot:
  `src/ts/server/scriptDefinitionBridge.svelte.ts:281`.
- `rollbackServerBackedScriptDefinitions()` discriminates scoped vs full rollback:
  `src/ts/server/scriptDefinitionBridge.svelte.ts:386`.
- Clone-cost and representative scoped rollback tests exist:
  `src/ts/server/scriptDefinitionBridge.svelte.test.ts:217`,
  `src/ts/server/scriptDefinitionBridge.svelte.test.ts:281`.

Completion gap:

- See "Phase 4 Debounced Rollback Baseline Can Drift" above. The existing tests
  do not exercise rapid same-key edits within the debounce window.

### Phase 5

Status: complete.

Evidence:

- `queuePromptItemUpdate` mirrors only one edited item into the projection before
  the debounced server command:
  `src/lib/Setting/Pages/PromptSettings.svelte:202`.
- `applyPromptItemProjectionWrite` clones only the edited item on the normal
  existing-row path:
  `src/ts/server/promptTemplateBridge.svelte.ts:44`.
- `restorePromptItemProjectionWrite` restores only that item:
  `src/ts/server/promptTemplateBridge.svelte.ts:72`.
- `reconcilePromptTemplateDraft` gates whole-template stringify/reconcile on the
  cached server command revision:
  `src/ts/server/promptTemplateBridge.svelte.ts:99`.
- `PromptDataItem` now clones the edited item once per change:
  `src/lib/UI/PromptDataItem.svelte:49`.
- Bridge tests cover single-item clone cost, scoped rollback, unchanged-revision
  zero clone/stringify, revision-advance reconcile, and matching-content no-op:
  `src/ts/server/promptTemplateBridge.svelte.test.ts:60`.

Residual caveats:

- Full-array fallback remains when the projection has no matching row or is not
  an array; that is not the normal textarea keystroke path.
- No Svelte integration test was found that drives actual typing through
  `PromptDataItem` into `queuePromptItemUpdate`.
- Debounce coalescing of the optimistic projection write remains intentionally
  deferred.

## Current Action

Before treating Phase 4 as fully complete, fix the script-definition watcher
debounced rollback baseline and add the rapid-edit failure regression. Phase 7
can still proceed independently, but this audit should remain linked from the
workstream router until the Phase 4 rollback gap is closed.
