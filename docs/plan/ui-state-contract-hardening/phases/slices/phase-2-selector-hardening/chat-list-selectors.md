# Slice: Chat List Selectors

Phase: [2](../../phase-2-selector-hardening.md). Runtime selector and test
change.

Status: complete.

## Scope

Add stable selectors to sidebar and modal chat lists, then migrate their nearby
tests away from styling, text-shape, and action-order coupling.

This slice owns only chat-list surfaces.

## Visible Contract

Chat row identity, selected state, folder placement, folder folded state, and row
actions must be assertable without `bg-selected`, Tailwind shape selectors, or
button array indexes.

## Anchors

- `src/lib/Others/ChatList.svelte`
- `src/lib/Others/ChatList.svelte.test.ts`
- `src/lib/SideBars/SideChatList.svelte`
- `src/lib/SideBars/SideChatList.svelte.test.ts`

## Target Shape

- `ChatList.svelte` exposes modal root, row id/index, selected state, and action
  kind selectors for create/import/edit/delete/export paths.
- `SideChatList.svelte` preserves existing reorder-critical
  `data-risu-chat-idx` and adds chat id, selected state, folder id, folder
  folded state, and action kind selectors.
- Tests use the semantic attributes for row lookup, selected assertions, and
  action clicks.

## Invariants

- Do not break drag/reorder selectors already consumed by `SideChatList`.
- Use domain attributes such as `data-risu-chat-id`, `data-risu-chat-selected`,
  and `data-risu-chat-action`.
- Do not refactor command behavior in this selector slice.

## Done Criteria

- Chat-list tests no longer depend on `bg-selected` or row action order.
- Optimistic create/delete/select visible proofs still pass.

## Validation

```bash
pnpm exec vitest run \
  src/lib/SideBars/SideChatList.svelte.test.ts \
  src/lib/Others/ChatList.svelte.test.ts
```
