# Phase 2: Selector Hardening

Status: planned.

Goal: add stable selectors to critical UI surfaces so DOM tests can assert
domain state instead of styling, layout, or action order.

## Scope

Prioritize these surfaces:

- `src/lib/Others/ChatList.svelte`
- `src/lib/SideBars/SideChatList.svelte`
- `src/lib/SideBars/Toggles.svelte`
- `src/lib/SideBars/CustomSidebar.svelte`
- `src/lib/Setting/botpreset.svelte`
- `src/lib/Setting/listedPersona.svelte`
- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/lib/ChatScreens/Chat.svelte`
- `src/lib/Setting/Pages/Module/ModuleSettings.svelte`
- `src/lib/Others/GridCatalog.svelte`

## Target Shape

Recommended selector contracts:

- Chat rows: stable chat id/index, selected state, action kind, folder id, folder
  expanded state.
- Chat list modal: modal root, row id/index/selected, row actions, create/import
  actions.
- Composer/send: `data-testid="default-chat-composer"` and
  `data-testid="default-chat-send-button"`.
- Message rows: stable message row/index/id near existing chat row markers.
- Generation controls: picker kind, toggle key/kind, toggle input, jailbreak
  control, and active picker mode.
- Preset/persona rows: id/index/selected plus `aria-selected` or
  `aria-current` where appropriate.
- Module and grid rows: stable row ids, state attributes, and action kinds.

## Invariants

- Prefer accessible labels or state attributes where they describe the real
  command; use `data-risu-*` for domain-specific state.
- Avoid selectors that expose incidental Tailwind classes.
- If base input/button components do not forward `data-*` or ARIA props, add
  selectors on stable wrappers rather than forcing a broad component refactor.

## Done Criteria

- High-value tests no longer rely on button order for chat, module, grid, and
  picker actions.
- Selected/active state assertions no longer depend only on `bg-selected`.
- Phase 3 and Phase 4 tests have stable selectors available.

## Validation

```bash
pnpm exec vitest run \
  src/lib/SideBars/SideChatList.svelte.test.ts \
  src/lib/Others/ChatList.svelte.test.ts \
  src/lib/SideBars/chatGenerationSettingsControls.test.ts \
  src/lib/Setting/pickerGenerationSettings.test.ts
pnpm exec vitest run \
  src/lib/Setting/Pages/Module/ModuleSettings.svelte.test.ts \
  src/lib/Others/GridCatalog.svelte.test.ts \
  src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts
pnpm check
```
