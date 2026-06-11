# Slice: Incomplete Remediation Send Guard

Phase: [4](../../phase-4-composed-generation-settings-ui.md). Test change.

Status: planned. Depends on Phase 2
[`composer-message-selectors.md`](../phase-2-selector-hardening/composer-message-selectors.md)
and
[`generation-settings-selectors.md`](../phase-2-selector-hardening/generation-settings-selectors.md).

## Scope

Add visible coverage for imported or incomplete chat generation-settings
remediation.

This slice does not change import normalization or server command behavior unless
the visible test exposes a current defect.

## Visible Contract

An incomplete chat remains visible, shows useful setup labels or prefilled
values, blocks send without clearing the composer, and becomes ready after the
user explicitly configures required settings.

## Anchors

- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`
- `src/lib/SideBars/Toggles.svelte`
- `src/ts/activeChatGenerationSettings.ts`
- `src/ts/chatGenerationSettings.ts`
- `src/ts/characters.ts`
- `server/fastify/__tests__/risuSaveImportRoute.test.ts`

## Target Shape

- Seed a chat with `generationSettings.configured = false` and valid prefilled
  ids/toggles when needed.
- Type in the composer through `default-chat-composer`.
- Click send through `default-chat-send-button`.
- Assert the guard error is visible or recorded by the alert mock.
- Assert composer text is not cleared by the blocked send.
- Complete the required setup through visible controls and assert ready state.

## Invariants

- Do not loosen the send guard.
- Do not clear the composer on blocked sends.
- Prefer current helper/server import tests for import normalization proof.

## Done Criteria

- A visible incomplete-chat remediation path exists.
- Composer preservation on blocked send is pinned.

## Validation

```bash
pnpm exec vitest run \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/ts/activeChatGenerationSettings.test.ts \
  src/ts/chatGenerationSettings.test.ts
```
