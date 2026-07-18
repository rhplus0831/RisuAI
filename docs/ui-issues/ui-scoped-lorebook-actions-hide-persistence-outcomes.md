# Character and chat lorebook actions hide persistence outcomes

## Summary

Structural and bulk actions in the character/chat lorebook editor optimistically
replace the scoped lorebook collection and return only a local boolean or
`void`. The replacement is debounced, staged in the durable outbox, and later
classified by the Fastify command path, but that classification never reaches
the initiating control.

The lorebook bridge has strong owner, projection-epoch, and attempted-entry
rollback guards. A terminal failure therefore usually reconciles the resource
instead of leaving it permanently divergent. The UI symptom is an unexplained
reappearance/removal/reorder or reverted activation. A retained mutation stays
optimistically visible with no queued state.

This is distinct from global lorebook deletion, which already has a dedicated
accepted/queued/failed state. Character `globalLore` and chat `localLore`
actions do not use that outcome-bearing path.

## Location

- `src/lib/SideBars/LoreBook/LoreBookSetting.svelte:71-92,217-280` initiates
  add/import/folder and bulk-always-active actions.
- `src/lib/SideBars/LoreBook/LoreBookList.svelte:225-285,371-488,655-714`
  removes, reorders, and replaces character/chat collections.
- `src/lib/SideBars/LoreBook/LoreBookData.svelte:268-276,360-404` invokes local
  chat activation and entry/folder removal.
- `src/ts/process/lorebook.svelte.ts:134-294,890-925` applies add, folder, and
  import mutations before dispatch.
- `src/ts/server/lorebookBridge.svelte.ts:630-749,793-823` exposes only
  local-success booleans for scoped edits/replacements/activation.
- `src/ts/server/lorebookBridge.svelte.ts:1454-1528,2600-2755` queues and
  launches the actual durable replacement with `void`.
- Rollback behavior is exercised across character and chat scopes in
  `src/ts/server/lorebookBridge.svelte.test.ts:2836-3025`.
- `src/ts/server/commands.ts:4027-4280` sends scoped replace/upsert/delete/reorder
  commands and reads their local effects.
- `server/fastify/src/routes/commands.ts:7084-7495` validates and persists
  character and chat lorebooks.

## Trigger

In the character or chat lorebook tab:

- add or import an entry;
- add or remove a folder/entry;
- drag an entry to reorder it or move it between folders;
- bulk-enable or bulk-disable `alwaysActive`;
- locally activate/deactivate a character lore entry in the active chat.

Then let the delayed command be retained after a retryable failure or rejected
terminally by Fastify.

## Expected behavior

Discrete lorebook operations should expose the exact durable outcome. Accepted
work should settle; retained work should be labelled queued; terminal failure
should show an error after guarded rollback. Destructive and bulk controls
should be disabled or serialized for the same scope while their operation is
unresolved.

## Actual behavior

`replaceCharacterLorebookCollection`,
`replaceChatLorebookCollection`, and
`setActiveChatLorebookLocalActivation` return `true` once the local projection
was changed. They do not represent persistence. Their dispatch functions call
`queueScopedLorebookReplacement`, which stages a 250 ms delayed outbox
generation; `runPendingReplacement` later launches `dispatchDurableMutation`
with `void`.

Add/folder/import helpers return without a result, and delete/reorder/bulk UI
handlers likewise keep no operation state. A terminal failure triggers scoped,
attempted-value-aware rollback, so the editor later renders the prior
collection with no explanation. Retryable failure retains the outbox and
optimistic entries, but the editor presents them as if accepted.

## Underlying cause

The lorebook migration added a server-backed bridge underneath an editor API
whose return value historically meant “the local `Database` array was
changed.” The bridge now knows the durable mutation handle and command result,
but discards them at both the debounce runner and the public collection API.
Only the newer special-case global-delete protocol exposes settlement state.

## Affected data flow

### Character lorebook

1. **UI interaction:** the character tab changes `characters[].globalLore` by
   stable entry ID.
2. **Client projection:** the bridge snapshots the selected character scope,
   assigns/clones the optimistic collection, normalizes IDs, and captures row
   and lorebook projection epochs.
3. **Request:** after debounce it chooses the smallest representable command:
   full `PUT /characters/:characterId/lorebooks`, entry upsert/delete, or entry
   reorder, with a base revision.
4. **Server persistence:** Fastify validates entries, mutates only the selected
   character's `globalLore`, and writes the exact character row using
   `writeSingleCharacterRow()`.
5. **Response:** success returns a revisioned `lorebook.entries.replaced` event
   and character/entry metadata. A local-effect certificate acknowledges the
   optimistic entry/collection; otherwise durable retention or scoped rollback
   applies.
6. **Displayed state:** LoreBookList reads the shared character resource and
   reflects the later settlement, but owns no status to explain it.

### Chat lorebook and local activation

1. **UI interaction:** the chat tab changes `chats[].localLore`, or local
   activation adds/removes a child entry with the parent lore ID.
2. **Client projection:** the bridge snapshots the stable `chatId`, applies the
   optimistic local collection, and captures its parent character-row epoch.
3. **Request:** it sends the corresponding
   `PUT|DELETE|POST /chats/:chatId/lorebooks...` command.
4. **Server persistence:** Fastify writes only the exact chat row with
   `writeSingleChatRowExact()`.
5. **Response:** the revisioned event targets the chat and parent character;
   local-effect acknowledgement, retention, or rollback updates the shared
   projection.
6. **Displayed state:** the chat tab and local-activation checkbox derive from
   that projection, but cannot distinguish queued from accepted or explain a
   rollback.

## Severity and likely user impact

**High.** Lorebooks directly affect prompting, and bulk/delete/import actions
can change many entries at once. Users may generate with a provisional
collection, see deleted content reappear after a rejection, or leave the page
believing a retained import is already durable. Silent outcomes undermine
trust even though the rollback itself is carefully scoped.

## Recommended fix

- Make queued replacements return an operation handle containing an immediate
  staging result and a `settlement` Promise classified as
  `accepted | queued | failed`.
- Expose that outcome through character/chat replace, activation, add/import,
  delete, and reorder helpers. Do not overload the existing boolean, which only
  means local applicability.
- Track pending state by lorebook scope and stable entry ID. Structural/bulk
  actions should show localized queued and terminal-failure messages.
- Preserve the existing debounce coalescing, entry-attempt rebasing, owner
  keys, projection epochs, and narrow rollback.
- If several edits coalesce into one durable generation, settle each UI action
  against the generation that contains or supersedes its exact intent.
- Add component tests for failed/queued add, delete, reorder, bulk activation,
  and chat-local activation.
