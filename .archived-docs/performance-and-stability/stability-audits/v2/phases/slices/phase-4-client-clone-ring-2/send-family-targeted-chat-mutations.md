# Slice: Send-Family Targeted Chat Mutations

Phase: [4](../../phase-4-client-clone-ring-2.md). Finding: L32. Runtime
change.

## Scope

Remove the remaining full `setDatabase` normalizer calls from slash-command
message mutations: the `/send` family and `mutateCurrentChatMessages`. These
paths already operate on the active chat and dispatch compatible chat update
commands, so the broad normalizer should not run per invocation.

This slice does not revisit the already-narrowed `/setvar` and `/addvar`
commands, prompt assembly message patching, or server message-store diffing.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L32.
- `src/ts/process/command.ts`: `/send`, `/sendas`, `/comment`, `/cut`, `/del`,
  `/multisend`, `mutateCurrentChatMessages`.
- `src/ts/chatCommands.ts`: `currentChatScopedSnapshot`,
  `dispatchCompatibleChatUpdateScoped`, chat rollback helpers.
- `src/ts/storage/database.svelte.ts`: `setDatabase` normalizer and language
  refresh side effects.
- Existing focused tests:
  `src/ts/process/__tests__/command.projectionGuard.test.ts`,
  `src/ts/chatCommands.test.ts`.

## Target Shape

- Replace `setDatabase(db)` inside message-only trusted writes with targeted
  in-place updates plus the existing compatible chat update dispatch.
- For `mutateCurrentChatMessages`, keep the one-chat before/after snapshots
  used for diffing and rollback, but do not send the live database through the
  whole `setDatabase` normalizer.
- For `/multisend`, avoid calling `setDatabase` once per generated send.
  Preserve clear-mode behavior, message append order, and the `sendChat(-1)`
  call after each split segment.
- Add behavior tests for each command shape whose mutation semantics are easy
  to regress: append user, append char, comment, cut by range/index/id, delete
  last N, and multisend with/without clear.
- Add cost coverage proving these commands do not call `setDatabase`, do not
  reclone the whole database, and do not trigger same-language merge churn.
- Register L32 as `DONE` in the v2 gate with focused command behavior and
  cost tests, and flip the L32 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- The active chat transcript after each command remains byte-identical to the
  old behavior.
- Command return values and pipe behavior remain unchanged.
- Server command dispatch still receives an accurate previous/next chat diff.
- Forced command failure restores the active chat only, preserving sibling chat
  and sibling character edits.

## Done Criteria

- The send-family command paths perform zero `setDatabase` calls on the
  focused cost tests.
- Per-command behavior tests pass for append, edit, cut, delete, and multisend
  cases.
- Forced-failure rollback tests prove only the active chat is restored.
- The v2 gate and active-risk row mark L32 `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/process/__tests__/command.projectionGuard.test.ts \
  src/ts/chatCommands.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
