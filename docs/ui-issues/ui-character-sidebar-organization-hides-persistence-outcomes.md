# Character sidebar organization hides persistence outcomes

## Summary

Dragging characters, creating folders, and editing folder name/color/image in
the main sidebar immediately changes the `characterOrder` projection. The
helpers return booleans that mean only “the local order changed”; their Fastify
reorder command is fire-and-forget. The sidebar therefore cannot show whether
an organization change was accepted, retained for replay, or rejected.

The command layer already guards rollback against newer reorder and metadata
edits and reasserts retained projections. The missing piece is UI settlement:
terminal failure makes the order or folder metadata silently revert, while a
retained change looks fully saved.

## Location

- `src/lib/SideBars/Sidebar.svelte:108-143,173-236` edits folder name, color,
  and image.
- `src/lib/SideBars/Sidebar.svelte:249-365,469-650` derives the displayed order
  and handles character/folder drag and drop.
- `src/ts/characterCommands.ts:1458-1510` stages the settings-owned character
  reorder with `void`.
- `src/ts/characterCommands.ts:1672-1882` implements move, folder creation, and
  folder metadata updates as local booleans.
- `src/ts/characterCommands.test.ts:1535-1885` demonstrates terminal rollback;
  `src/ts/characterCommands.test.ts:2053-2098` demonstrates a retained reorder
  that stays optimistically projected for replay.
- `src/ts/server/commands.ts:3437-3450` sends the reorder command.
- `server/fastify/src/routes/commands.ts:5360-5400` persists character order.

## Trigger

- Drag a character or folder to a new position.
- Drop one character onto another to create a folder.
- Move a character into or out of a folder.
- Rename/recolor a folder, reset its image, or upload a new folder image.

Then let `POST /characters/reorder` be retained or fail terminally.

## Expected behavior

The sidebar should keep the exact order/folder operation pending until the
durable owner classifies it. Accepted work can settle, queued work should be
marked provisional, and terminal failure should render the guarded rollback
with an error. Conflicting drag or metadata actions should be serialized or
independently tracked.

## Actual behavior

`moveCharacterOrderItem`, `createCharacterOrderFolder`, and
`updateCharacterOrderFolder` mutate and normalize `getDatabase().characterOrder`
then return `true`. `dispatchCharacterOrderCommand` stages a durable reorder and
invokes `dispatchDurableMutation` with `void`; its Promise is used internally
only to reapply a retained projection.

`Sidebar.svelte` treats the boolean/local call as completion. It has no pending
state and no result handling. A terminal server rejection restores the prior
structure or attempted folder fields when they are still current, causing a
silent snap-back. A retryable failure keeps/reasserts the optimistic order and
outbox row, with no queued marker. Folder-image upload can complete its asset
step and briefly display the image even if the subsequent order/settings write
is rejected.

## Underlying cause

Character ordering remains a settings scalar on the server, but the sidebar
API preserved the old in-memory `Database` contract. The boolean describes
local validation/application rather than persistence. The durable command's
settlement and retention disposition are not exposed above
`dispatchCharacterOrderCommand`.

## Affected data flow

1. **UI interaction:** the drag controller or folder action dialog identifies
   stable character/folder IDs.
2. **Client projection:** the helper updates `characterOrder`, normalizes active
   IDs/folder membership, and captures the previous structure or folder-field
   rollback data. `createSidebarCharacterListMemo` derives rendered rows from
   this projection.
3. **Request:** the helper stages
   `POST /api/v1/commands/characters/reorder` with `baseRevision` and the full
   normalized `characterOrder`.
4. **Server persistence:** Fastify validates that the order is complete and
   asset references are valid, assigns `target.characterOrder`, and persists
   the settings record with `writeSettingsOnly()`.
5. **Response/acknowledgement:** success returns a revision,
   `character.reordered`, and selected-character ID. Retryable failure retains
   the outbox and reasserts the latest fenced projection; terminal failure uses
   generation and attempted-value guards to restore the applicable prior data.
6. **Displayed state:** the sidebar reactively rerenders `charImages` from the
   shared resource, but the initiating drag/dialog has no accepted, queued, or
   failed status.

## Severity and likely user impact

**Medium.** No character content is deleted, but organization is a primary
navigation surface and folder images may involve an uploaded asset. Silent
snap-back makes drag/drop appear unreliable; silent retention can replay a
layout change in a later session after the user assumes it was saved.

## Recommended fix

- Return a Promise/outcome handle from the character-order command owner and
  propagate `accepted | queued | failed` through move/create/update helpers.
- Track pending operations by the exact order generation and folder ID. Avoid
  globally disabling the sidebar when only one folder field is pending.
- Show a small queued state for retained changes and a localized failure
  notification after terminal rollback.
- Keep the existing generation fence and field-scoped rollback so older
  failures cannot overwrite newer order/folder work.
- For folder images, associate asset upload and settings persistence in one UI
  operation and do not report completion until the latter is classified.
- Add sidebar tests with deferred reorder responses and multiple rapid edits.
