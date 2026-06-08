# Slice: Rollback Suppression

Phase: [5](../../phase-5-client-write-path-correctness.md). Findings: L23,
L24, and L26. Client optimistic-write correctness change. Coordinates with
unload-flush.

## Scope

Make every rollback path that writes back into server-backed client projection
state suppress the bridge watcher that would otherwise observe the rollback as
a fresh user edit.

This slice owns suppression wiring for settings rollbacks, global-lorebook
direct dispatcher rollbacks, and chat-row metadata rollbacks. It does not
change conflict detection, command payload validation, or unrelated optimistic
command sequencing.

## Anchors

- [`../../../audit-stability-and-performance-v3.md`](../../../audit-stability-and-performance-v3.md)
  L23, L24, and L26.
- `src/ts/server/settingsBridge.svelte.ts`:
  `applyServerBackedSettingsPatch`, `watchServerBackedSettings`, the
  `suppressDraftDispatch` precedent, and settings rollback paths.
- `src/ts/gui/colorscheme.ts` and display settings components that call
  `applyServerBackedSettingsPatch` directly.
- `src/ts/server/lorebookBridge.svelte.ts`:
  `dispatchUpdateGlobalLorebook`, `restoreLorebookState`,
  `restoreScopedLorebookState`, and `rollbackServerBackedLorebooks`.
- `src/ts/server/chatBridge.svelte.ts`: unused or incomplete
  `rollbackServerBackedChatMetadata` shape.
- `src/ts/chatCommands.ts`: `restoreChatRowMetadata`,
  `dispatchUpdateChatRow`, and optimistic rollback wiring.
- Focused tests:
  `src/ts/server/settingsBridge.svelte.test.ts`,
  `src/ts/server/lorebookBridge.svelte.test.ts`,
  and `src/ts/server/chatBridge.svelte.test.ts`.

## Target Shape

- Add the same microtask-reset suppression shape already used by
  `rollbackServerBackedLorebooks` to settings and chat metadata rollback
  paths.
- In `applyServerBackedSettingsPatch`, suppress watcher dispatch for both:
  the immediate trusted optimistic write, and
  the rollback write that restores the prior values after command failure.
- Ensure direct color/theme settings calls still dispatch exactly one command
  for the user edit.
- For global lorebooks, route direct dispatcher rollback through
  `rollbackServerBackedLorebooks` or an equivalent wrapper that sets the
  lorebook suppression flag before restoring.
- For chat-row metadata, wrap `restoreChatRowMetadata` with a suppressing
  rollback helper and use that helper from server-backed optimistic command
  paths.
- After a chat-row metadata rollback, reset the watcher previous snapshot to
  the restored baseline so sustained conflicts cannot oscillate
  baseline-to-optimistic.
- Add a sibling-parity proof that every bridge rollback path writes under the
  matching suppression flag.
- Register L23, L24, and L26 as `DONE` in
  `src/ts/__tests__/fixCompletenessGateV3.test.ts` and flip only those rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  implementation change.

## Invariants

- User edits still dispatch one command.
- Rollback writes dispatch zero commands.
- Suppression is bridge-local and clears in a microtask, matching the existing
  precedent.
- A suppressed rollback must not hide the next genuine user edit after the
  microtask clears.
- Chat metadata rollback leaves the watcher baseline equal to the restored
  state.

## Done Criteria

- Theme/color settings changes dispatch exactly one command.
- A failed settings command restores the previous values and dispatches no
  second command from the watcher.
- A failed global-lorebook command restores state without re-dispatching.
- A failed chat metadata command restores state without re-dispatching or
  oscillating under repeated conflicts.
- Sibling-parity tests prove every settings, lorebook, and chat metadata
  rollback path sets the relevant suppression flag.
- L23, L24, and L26 are registered as `DONE` in the v3 gate and active-risk
  table, with no unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run \
  src/ts/server/settingsBridge.svelte.test.ts \
  src/ts/server/lorebookBridge.svelte.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
