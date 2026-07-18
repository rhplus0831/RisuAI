# Legacy plugin setters hide persistence outcomes

## Summary

The legacy Plugin V2 `setChar` and `setArg` APIs optimistically update the
shared client resource and start a durable Fastify mutation, but return before
that mutation is classified as accepted, queued, or failed. The newer Plugin
V3 setters now await this classification, but V2 plugins—and V3 plugins using
the deprecated `setArg` alias—still receive an immediate successful return.

The mutation owners have guarded rollback and durable retry logic. The defect
is at the plugin/UI acknowledgement boundary: a plugin can report that it saved
data and run dependent logic even though the server later rejects the change or
has only queued it for replay.

## Location

- `src/ts/plugins/plugins.svelte.ts:1157-1193` creates the V2 API object.
- `src/ts/plugins/plugins.svelte.ts:1212-1236` implements `getChar`/`setChar`.
- `src/ts/plugins/plugins.svelte.ts:1286-1305` implements `setArg`.
- `src/ts/plugins/apiV3/v3.svelte.ts:933-953,1001-1003` shows the corrected
  awaitable character setter used by V3.
- `src/ts/plugins/apiV3/v3.svelte.ts:1234-1265` still exposes the V2 `setArg`
  as the deprecated alias while the replacement `setArgument` awaits the real
  mutation outcome.
- `src/ts/characterCommands.ts:1282-1313` exposes both the void `dispatch()`
  and outcome-bearing `dispatchAsync()` compatibility paths.
- `src/ts/pluginCommands.ts:54-57,291-300,363-417` defines and returns
  `PluginMutationOutcome` for plugin-row updates.
- `src/ts/server/commands.ts:3358-3372,4776-4791` sends the character and plugin
  PATCH requests and decodes their local effects.
- `server/fastify/src/routes/commands.ts:5076-5131,7796-7837` validates and
  persists the two mutations.

## Trigger

1. A live V2 plugin calls `setChar(nextCharacter)` or
   `setArg("pluginName::key", value)`, commonly from a plugin-provided control.
   A V3 plugin can also hit the latter path through deprecated `setArg`.
2. The plugin treats the synchronous return as completion, updates its own UI,
   reads the value back, or starts a dependent operation.
3. Fastify later rejects the PATCH, or the durable dispatcher retains it after
   a retryable transport failure.

## Expected behavior

A server-backed plugin mutation should expose whether it was accepted by
Fastify, durably queued for replay, or terminally failed. Plugin logic should be
able to sequence dependent work after that classification, and a plugin UI
should not report durable success while the request is unresolved.

## Actual behavior

`setChar` replaces the selected character projection and calls
`preparation.dispatch()`, whose implementation is explicitly
`() => void dispatchAsync()`. `setArg` updates `plugins[].realArg` and ignores
the `Promise<PluginMutationOutcome>` returned by `dispatchUpdatePlugin`.

Both API calls therefore return as soon as the optimistic client write is
staged. A terminal failure can later restore the attempted character fields or
plugin argument, making the displayed value revert with no outcome delivered
to the plugin. A retained failure leaves the optimistic value visible and the
outbox entry live, but is indistinguishable from server acceptance.

This is not the already-fixed Plugin V3 setter issue: V3 `setCharacter` and
`setArgument` now await the same outcome-bearing functions. Only the legacy
surface still discards them.

## Underlying cause

The V2 API retained its frontend-owned `Database` contract, where applying a
local value was effectively the save. After persistence moved to Fastify, the
implementation acquired asynchronous command owners but preserved void setter
semantics. The compatibility layer now has the information needed to classify
the write, but deliberately selects or ignores the fire-and-forget path.

## Affected data flow

### `setChar`

1. **Plugin interaction:** plugin code calls the global V2 `setChar` API.
2. **Client projection:** the bridge snapshots the selected character, derives
   a sanitized patch, and assigns the optimistic character to
   `getDatabase().characters[charid]`.
3. **Request:** `dispatchAsync()` would stage a durable
   `PATCH /api/v1/commands/characters/:characterId` with `baseRevision` and
   `{ patch }`, but `setChar` calls its void wrapper.
4. **Server persistence:** Fastify validates the patch and writes the exact row
   with `writeSingleCharacterRow()`.
5. **Response:** success returns a revision, `character.updated` (or the trash
   variant), and `characterId`; the client local effect acknowledges matching
   optimistic fields. A terminal failure invokes attempted-field rollback.
6. **Displayed state:** plugin and native UI read the shared character
   projection, but the initiating plugin receives no settlement and can show
   success before a later rollback.

### `setArg`

1. **Plugin interaction:** plugin code calls V2/deprecated `setArg`.
2. **Client projection:** the bridge changes the matching plugin's `realArg`.
3. **Request:** `dispatchUpdatePlugin` stages
   `PATCH /api/v1/commands/plugins/:pluginId` with `{ patch: { realArg } }`.
4. **Server persistence:** Fastify updates the plugin collection row with
   `writeSingleCollectionRow()`.
5. **Response:** success returns a revision, `plugin.updated`, and `pluginId`;
   the durable owner otherwise retains or rolls back the exact attempted field.
6. **Displayed state:** native settings and plugin reads observe the resource
   projection, while the setter caller has already continued without knowing
   which result occurred.

## Severity and likely user impact

**High.** Third-party plugin controls can explicitly claim a save that did not
persist, and chained plugin operations can execute under a false durability
assumption. Character changes can affect prompting and behavior, while argument
changes control the plugin itself. The eventual unexplained reversion looks
like data loss; a silent queued mutation can also replay after the user assumes
the operation is complete or failed.

## Recommended fix

- Return the real Promise from V2 `setChar` and `setArg`, or add documented
  async counterparts and migrate the in-app compatibility callers to them.
- Translate the exact durable result into a common
  `accepted | queued | failed` outcome. Ignoring a returned Promise remains
  backward-compatible for old plugins, while plugins that opt in can await it.
- If the historical API must remain strictly void, publish a mutation-id keyed
  settlement event and a host-level localized failure/queued notification so a
  plugin UI cannot be the only observer.
- Re-check plugin lifecycle currency after an awaited result before invoking
  plugin callbacks.
- Add V2 tests with deferred accepted, retained, and terminal responses that
  assert the plugin-visible operation does not falsely signal completion.
