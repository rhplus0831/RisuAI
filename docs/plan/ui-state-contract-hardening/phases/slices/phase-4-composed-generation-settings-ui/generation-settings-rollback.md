# Slice: Generation Settings Rollback

Phase: [4](../../phase-4-composed-generation-settings-ui.md). Test change.

Status: planned. Depends on Phase 2
[`generation-settings-selectors.md`](../phase-2-selector-hardening/generation-settings-selectors.md).

## Scope

Audit and, if needed, add visible rollback coverage for failed active-chat
generation-settings saves.

This slice does not duplicate every command rollback test.

## Visible Contract

If a chat generation-settings save is applied optimistically and then fails, the
visible labels or controls should restore to the previous chat-owned settings.

## Anchors

- `src/ts/chatCommands.ts`
- `src/ts/chatCommands.test.ts`
- `src/lib/SideBars/Toggles.svelte`
- `src/lib/Setting/pickerGenerationSettings.test.ts`
- `src/lib/SideBars/chatGenerationSettingsControls.test.ts`

## Target Shape

- First confirm existing lower-layer rollback proof for
  `dispatchUpdateChatGenerationSettings`.
- Add a focused DOM assertion if visible controls can exercise the failing save
  path without broad mocks.
- If lower-layer rollback is sufficient and visible failure requires brittle
  harnessing, record the decision in `latest-verification.md`.

## Invariants

- Do not weaken optimistic command rollback semantics.
- Do not add broad browser smoke for this component-level failure.

## Done Criteria

- Visible rollback is covered or an explicit proof-backed skip reason is
  recorded.

## Validation

```bash
pnpm exec vitest run \
  src/ts/chatCommands.test.ts \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/lib/Setting/pickerGenerationSettings.test.ts
```
