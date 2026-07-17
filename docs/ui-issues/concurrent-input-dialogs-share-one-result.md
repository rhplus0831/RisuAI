# Concurrent input dialogs share one unowned result

## Summary

The shared alert service queues and owner-scopes confirmations and select dialogs, but `alertInput()` still writes directly to one global store and waits for the next generic `type: "none"` value. If a second input request arrives while the first is open, it replaces the visible prompt and both callers resolve with the single submitted value. An OAuth code, trigger response, Realm identifier/report, password, or rename can therefore be consumed and persisted by an unrelated workflow.

## Location

- `src/ts/alert.ts:6-44,71-88,133-348,392-409,638-647`
- `src/lib/Others/AlertComp.svelte:183-209,301-310,341-368,555-583`
- `src/lib/ChatScreens/Chat.svelte:1363-1469`
- `src/ts/chatCommands.ts:2388-2435`
- `src/ts/server/commands.ts:3418-3433`
- `server/fastify/src/routes/commands.ts:5196-5260`
- `src/ts/process/triggers.ts:1852-1884,2930-2940`
- `src/ts/process/mcp/mcplib.ts:1290-1317`
- `src/lib/UI/Realm/RealmMain.svelte:104-115`
- `src/lib/UI/Realm/RealmPopUp.svelte:56-73`
- `src/ts/alert.test.ts:90-218,220-311,313-366`

## Trigger

A concrete production ordering is:

1. While a generation or other asynchronous workflow is in progress, open the bookmark-name prompt for an existing message.
2. Before answering it, let a low-level trigger, plugin/script, or MCP OAuth flow call `alertInput()` for its own response. The background request replaces the bookmark prompt.
3. Enter the value requested by the now-visible second prompt, such as an authorization code or trigger variable.
4. Observe that the bookmark workflow also resumes and persists the same value as the bookmark name.

The inverse ordering has the same defect. Two background triggers that request input concurrently are sufficient; no ordinary UI click through the modal is required.

## Expected behavior

Each input prompt should retain a distinct owner and resolve only its own caller. Concurrent inputs should be serialized FIFO (as confirmations and selects already are), or an explicitly superseded prompt should resolve as cancellation. A submission must never be observable by another workflow.

## Actual behavior

The most recent call replaces the earlier prompt's message/default/datalist. Pressing Enter, OK, Cancel, or Escape writes one ownerless `{ type: "none", msg: value }`. Every active `waitAlert()` subscription resolves from that same store value, so both promises return the same string. Both workflows then continue as though the user answered them individually.

For the bookmark path, the unrelated value is applied optimistically to `chat.bookmarkNames`, sent to Fastify, acknowledged, and rendered as durable chat metadata. If the shared value is an OAuth code or password-like secret, this also creates a confidentiality risk by copying it into chat data, an external Realm request, or a trigger variable.

## Underlying cause

`responseDialogTypes` correctly prevents passive status alerts from replacing an active input, but it does not provide ownership among response dialogs. Confirmation and selection requests each have a queue, a unique `dialogOwner`, an owner-aware resolver, and typed cancellation. Inputs have none of those mechanisms: `alertInput()` unconditionally overwrites `alertStoreImported`, then calls the generic `waitAlert()`.

`waitAlert()` subscribes only to `value.type === "none"`; it does not filter by dialog type or owner. `AlertComp.closeInputAlert()` likewise publishes no owner. Therefore all pending input callers share the next terminal store transition. The existing tests cover concurrent confirmations/selects and passive alerts around one input, but never start two input requests together.

## Affected data flow

1. **First UI action/state:** `Chat.toggleBookmark()` clones the target chat's bookmarks/names and awaits `alertInput()` before updating its local projection.
2. **Competing request:** An asynchronous trigger (`showAlert`/`v2GetAlertInput`), MCP OAuth attempt, script/plugin, or other UI workflow calls `alertInput()`. It overwrites the same alert store.
3. **Displayed UI:** `AlertComp` renders only the second input's label/default/datalist because there is one global `input` value.
4. **Shared acknowledgement:** Submitting writes `{ type: "none", msg }`; both `waitAlert()` promises resolve with `msg` because neither has owner identity.
5. **Client projection:** The bookmark path assigns that string to `bookmarkNames[messageId]` and applies optimistic chat metadata. The second caller also consumes it for its unrelated purpose.
6. **Server request:** `dispatchUpdateChatScoped()` sends `PATCH /api/v1/commands/chats/:chatId` with the contaminated `bookmarkNames` and the current base revision.
7. **Server persistence/response:** Fastify validates the chat patch, writes the chat row, advances the revision, and returns a `chat.updated` event plus ids.
8. **UI reconciliation:** The command acknowledgement preserves/reconciles the optimistic chat metadata, so bookmark lists and message controls consistently display the wrong but now-authoritative value.

## Severity and user impact

**High when inputs overlap; medium likelihood.** The defect silently routes user data to the wrong consumer and can durably mutate chat metadata or issue an unintended external request. Several input call sites accept sensitive material, while triggers/plugins can initiate prompts asynchronously, making this more than a cosmetic modal collision. The user sees only one prompt and has no indication that another hidden caller also accepted the response.

## Recommended fix

Implement input ownership using the same service pattern as confirmations/selects:

- Add an `InputRequest` FIFO queue with a unique `AlertDialogHandle`, prompt metadata, and resolver.
- Include `dialogOwner` in displayed input state and add `resolveAlertInput(owner, value | null)` that rejects stale/unowned callbacks.
- Have `AlertComp` capture the rendered owner for OK, Enter, Escape, Cancel, and teardown; cancellation should resolve only that request with a typed `null` (or a documented compatibility value at the public wrapper).
- Coordinate all result-bearing dialog queues through one scheduler so an input, confirmation, and select cannot replace one another or consume one another's terminal state.
- Reserve generic `waitAlert()` for passive/legacy non-result dialogs, or require an owner predicate for any remaining response caller.
- Audit password/OAuth callers so sensitive values are never placed in the shared presentation store longer than necessary and are cleared after resolution.

## Test coverage gap

Add a service test that starts two `alertInput()` calls, verifies only the first is displayed, submits it, verifies only the first resolves, then submits the second and verifies distinct results. Add mixed input/confirm/select ordering and stale-button tests. A mounted `AlertComp` test should exercise Enter and Escape across the queued prompts. Finally, add an integration test around bookmark naming plus a deferred background input and assert that the background value is never included in the chat PATCH.
