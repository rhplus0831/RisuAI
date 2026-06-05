# Slice: Partial Edit Shared Hover Handler

Phase: [5](../../phase-5-client-render-and-ui.md). Finding: L41. Runtime
change.

## Scope

Hoist block partial-edit hover tracking from one document-level `mousemove`
listener per visible message to one shared listener for the chat surface.

This slice does not change partial-edit save/delete behavior, drag-selection
editing, markdown parsing, or message virtualization.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L41.
- `src/lib/ChatScreens/PartialEditController.svelte`: `bodyRoot`,
  `isBlockActive`, `isDragActive`, `SELECTOR`, `showBlockButton`,
  `hideBlockButton`, the document `mousemove` effect, and the rect-scanning
  fallback.
- `src/lib/ChatScreens/Chat.svelte`: `PartialEditController` creation per
  visible message.
- New focused test home:
  `src/lib/ChatScreens/PartialEditController.sharedHover.test.ts`.

## Target Shape

- Create a module-level registry for mounted partial-edit controllers, or an
  equivalent shared helper, that installs at most one document `mousemove`
  listener while block partial-edit hover tracking is active.
- Keep one shared `requestAnimationFrame` throttle for hover work. The shared
  handler should route the current pointer to the controller whose `bodyRoot`
  contains the hovered block or floating-button zone.
- Preserve per-controller state and callbacks for showing/hiding its own block
  button. A controller unmount must unregister cleanly and hide its button when
  appropriate.
- Keep document scroll hiding behavior shared if practical; if it remains
  per-controller, document why only `mousemove` is the L41 cost center.
- Leave drag-edit `selectionchange` behavior alone unless sharing it is simpler
  and covered by tests.
- Add a regression test that mounts multiple visible controllers and proves
  only one document `mousemove` handler is registered, then unmounts and proves
  it is removed.
- Register L41 as `DONE` in the v2 gate with listener-count and behavior tests,
  and flip the L41 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- The block partial-edit button must still appear for text blocks under the
  pointer and remain reachable in the existing button zone.
- Text selection must still suppress block hover UI.
- Leaving a message body or scrolling must hide stale block buttons.
- Unmounting a visible message must not leave document listeners, animation
  frames, or stale registry entries behind.

## Done Criteria

- Visible-message count no longer changes the number of document `mousemove`
  listeners.
- Hover, leave, selection, and scroll behavior remain unchanged in focused
  component tests.
- L41 is registered as `DONE` with real tests in the v2 gate and risk map.

## Validation

```bash
pnpm exec vitest run src/lib/ChatScreens/PartialEditController.sharedHover.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm check
pnpm exec tsc -p tsconfig.client-lib.json
```
