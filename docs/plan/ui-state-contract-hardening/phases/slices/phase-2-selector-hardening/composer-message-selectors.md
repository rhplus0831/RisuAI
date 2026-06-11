# Slice: Composer And Message Selectors

Phase: [2](../../phase-2-selector-hardening.md). Runtime selector and test
change.

Status: planned.

## Scope

Add stable selectors for the default chat composer, send button, and message-row
aliases needed by later visible tests.

This slice does not change send behavior.

## Visible Contract

Tests should be able to enter composer text, click send, and assert rendered
message rows by stable domain markers.

## Anchors

- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`
- `src/lib/ChatScreens/Chat.svelte`
- `src/lib/ChatScreens/ChatBody.svelte.test.ts`

## Target Shape

- `DefaultChatScreen.svelte` exposes `data-testid="default-chat-composer"` and
  `data-testid="default-chat-send-button"`.
- `Chat.svelte` keeps existing `data-chat-index` and `data-chat-id`; add clearer
  `data-risu-message-*` aliases only if they improve Phase 4/5 tests without
  churn.
- Tests use stable composer/send selectors instead of `.button-icon-send` or
  generic textarea lookup.

## Invariants

- Do not rename existing selectors already used by tests.
- Treat `Message.chatId` as the available stable message id when present; do not
  invent a new persisted id shape in this slice.

## Done Criteria

- Default chat screen tests can find composer and send button semantically.
- Existing load-page and screenshot tests still pass.

## Validation

```bash
pnpm exec vitest run \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts \
  src/lib/ChatScreens/ChatBody.svelte.test.ts
```
