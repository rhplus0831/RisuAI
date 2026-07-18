# Generation error restoration overwrites newer accepted chat edits

## Summary

Provider and prompt-assembly failures can return a restoration payload containing
the transcript and script state captured when generation was assembled. The
client applies that payload by replacing the live chat wholesale. If the user
edits, deletes, disables, translates, or otherwise mutates a message while the
provider is running, a later generation error can therefore replace the newer
local projection with the older assembly-time snapshot even when the intervening
command was accepted and persisted by Fastify.

## Location

- `src/lib/ChatScreens/Chats.svelte:177-180` marks only the empty final
  assistant placeholder as generation-loading.
- `src/lib/ChatScreens/Chat.svelte:1719-1741,2067-2147` continues to expose
  message mutation controls on the other rows during generation.
- `src/lib/ChatScreens/Chat.svelte:980-1010` dispatches a message edit.
- `src/ts/chatCommands.ts:4775-4869` records mutation intent and sends the
  scoped message command.
- `src/ts/process/request/serverChat.ts:717-743` decodes an SSE error's
  restoration payload.
- `src/ts/process/serverBackedSendChat.ts:500-526` applies any restoration on a
  terminal error without a freshness check.
- `src/ts/process/request/serverMessagePatch.ts:66-74` replaces
  `chat.message` and `chat.scriptstate` from the restoration.
- `server/fastify/src/prompt/assemble.ts:1146-1155` builds the restoration from
  the assembly state's initial messages and script state.
- `server/fastify/src/prompt/providerTransport.ts:123-143,159-170` attaches that
  restoration to provider error frames and provider exceptions.
- `server/fastify/src/routes/generationChat.ts:3037-3055,3106-3116` supplies the
  restoration to the durable generation stream.
- `server/fastify/src/routes/commands.ts:6235-6303` is the independent durable
  message-update path that can accept the user's intervening edit.

## Trigger

1. Start a server-backed generation.
2. Before the provider finishes, edit, remove, disable, or translate a message
   that already exists in the transcript. The controls remain available unless
   the row is the exact empty generation placeholder.
3. Allow the corresponding Fastify command to succeed.
4. Make the provider stream fail, or make prompt assembly stop through a path
   that includes `restoration`.

Editing a Continue target is an especially direct reproduction because it is an
existing durable message and remains visible while its continuation is running.

## Expected behavior

Generation failure should undo only state optimistically owned by that
generation. It must not overwrite an independently accepted message mutation
that happened after the generation snapshot was captured. After the error, the
browser should still display the version stored by Fastify.

## Actual behavior

The terminal error handler assigns the old `restoration.messages` array to the
current chat and also restores the old script state. The intervening message
command can already be present in SQLite, so the browser and server immediately
disagree: the UI shows the old value until a later authoritative hydration or
reload happens to repair it. Because the command's event may already have been
processed before the error arrives, there need not be another event to repair
the projection promptly.

## Underlying cause

`buildRestorationPayload()` is a generation-level snapshot, but it is consumed
as an unconditional authoritative replacement. The payload carries stable chat
identity but no baseline resource revision, transcript digest, message mutation
intent epoch, or body-projection epoch. `applyServerBackedTerminal()` therefore
has no way to tell that the live transcript advanced after assembly.

The retained-chat projection logic does not close this gap. It re-applies
pending/retryable command projections across authoritative resource reads; it
does not protect an already accepted command from a later arbitrary assignment
of an older transcript snapshot.

## Affected data flow

1. **UI interaction:** A message control in
   `src/lib/ChatScreens/Chat.svelte` changes a visible row while generation is
   active.
2. **Client projection:** The scoped chat command applies the patch
   optimistically and advances the chat's mutation-intent tracking.
3. **Request:** The client sends, for example,
   `PATCH /api/v1/commands/messages/:messageId` with the message patch and base
   revision.
4. **Server persistence:** Fastify validates the target and persists the patch
   in the message row, returning a new revision and `message.updated` event.
5. **Generation failure:** The independent `POST /api/v1/generate/chat` job
   later emits an SSE `error` containing the older assembly restoration.
6. **Acknowledgement:** The generation terminal promise resolves as an error;
   the restoration has no revision or conditional-apply contract.
7. **Displayed state:** `applyServerChatRestoration()` replaces the current
   message array and script state, painting the pre-edit version over the newer
   projection while SQLite retains the accepted edit.

## Severity and likely user impact

**High.** Provider failures are already disruptive, and this turns them into an
apparently lost edit or contradictory cross-component state. The user can repeat
the edit unnecessarily, make decisions based on stale content, or only discover
after reload that the server stored a different version. Whole-array replacement
also broadens the blast radius beyond the row involved in generation.

## Recommended fix

Replace snapshot restoration with a generation-owned rollback protocol:

1. Capture the chat revision, transcript/body projection epoch, mutation-intent
   epoch, and the exact generation-owned optimistic delta when dispatch starts.
2. On error, remove or restore only rows/fields still equal to that generation's
   attempted values. Do not touch any row whose stable ID, value, or mutation
   epoch advanced independently.
3. If the server cannot express a narrow inverse, fetch/hydrate the
   authoritative chat body and reapply retained pending projections instead of
   installing the assembly snapshot.
4. Treat disabling message mutations during generation as an optional defensive
   UI measure, not the concurrency guarantee.

## Test gap

Add an end-to-end generation test that pauses a failing provider, accepts a
message `PATCH`, then emits the provider error. Assert that SQLite and the live
chat both retain the patched value and that only the generation-owned placeholder
or optimistic changes are rolled back. Include a second case in which a newer
local edit is still pending when the error arrives.
