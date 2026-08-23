# Regenerate Transcript Projection Cleanup — Implementation Plan

## Status

Implemented on 2026-08-23. This plan replaces the earlier contents of
`PLAN.md` and records the completed cleanup.

## Objective

Make regenerate/reroll an in-place generation operation from the user's point
of view:

- the assistant row being regenerated remains present while prompt assembly is
  running;
- provider output streams into a transient projection of that logical row;
- successful finalization atomically hands the row to the new authoritative
  message;
- failure or non-retaining cancellation leaves the original assistant intact;
- a transcript that was following the newest row remains at the natural end
  throughout the operation;
- prompt-only transcript transformations never leak into the visible or
  authoritative transcript.

The cleanup should remove the current dependency on deleting the target from
the browser message array and appending an empty row under a new ID.

## Current Defect

The current path mixes three different transcript concepts:

1. The authoritative transcript loaded from SQLite.
2. The working transcript used to assemble the next prompt.
3. The browser's visible streaming projection.

For regenerate, `prepareRegenerateTranscript()` correctly removes the target
from the working prompt. It then captures that removal as a `regenerate`
`replace_all` mutation. The route emits the mutation as `message_patch`, and the
browser applies it to the visible message array. `consumeStreamResponse()` then
appends an empty assistant with the generation ID.

The removal and append normally settle in one Svelte update, so the message
count before and after is identical. `Chats.svelte` therefore does not enter its
"new empty assistant" natural-end branch, even though the latest row's identity
and height changed. The browser's reverse-scroll anchoring moves the transcript
away from `scrollTop = 0`, the scroll handler can interpret that as manual
history navigation, and completion has no natural-end state to restore.

This is also a semantic boundary bug: the server finalization code already
requires the regenerate target to remain authoritative until finalization, but
the prompt assembly patch temporarily removes it from the browser projection.

## Required Invariants

1. SQLite active message rows are authoritative. Prompt assembly may not change
   the browser transcript unless a corresponding authoritative mutation was
   successfully committed.
2. Regenerate truncation is prompt-only. It must never appear in an
   authoritative or visible transcript patch.
3. A fresh regenerate targets the latest assistant by stable message ID and
   transcript lineage. It must fail safely if that target is no longer current.
4. The original assistant remains recoverable until finalization commits the
   generated primary and reroll alternate rows.
5. Streaming text is transient UI state. It is not inserted into the
   authoritative resource projection before the server accepts the final write.
6. A retained partial result becomes visible authority only through the same
   terminal/finalization contract as a complete result.
7. Reattach must reconstruct the same transient projection without appending a
   duplicate assistant.
8. Background-chat generation must not rebuild or scroll the foreground chat.
9. Cached reroll-candidate navigation remains an authoritative candidate switch
   and does not enter the fresh-generation projection path.
10. User-initiated scrolling away from the newest row cancels follow mode. A
    programmatic layout shift during regeneration does not.

## Non-Goals

- Do not change prompt content or the legacy `saying` boundary used to build a
  regenerate prompt.
- Do not change reroll alternate persistence or candidate ordering.
- Do not make partial provider text an ordinary message mutation.
- Do not redesign Send or Continue except where shared generation-projection
  code makes their existing behavior safer.
- Do not solve general list virtualization in this workstream.
- Do not paper over the defect with a delayed click-handler scroll.

## Target Architecture

### 1. Separate Working and Authoritative Mutations

Prompt assembly needs two explicit mutation channels:

```ts
interface AssemblyMutationChannels {
  // Internal only. Changes what scripts and prompt construction see.
  workingTranscriptMutations: WorkingTranscriptMutation[]

  // Emitted only after the corresponding server write is accepted.
  authoritativeMutations: AuthoritativeMutationPayload
}
```

`prepareRegenerateTranscript()` should continue truncating
`state.currentChat.message` for prompt construction, but that truncation must
stay in `workingTranscriptMutations`. It must not call the outward
`captureMessageReplacement(state, 'regenerate')` path.

Simply filtering mutations whose source is `regenerate` is insufficient.
Subsequent run-var, trigger, regex, Agent Preset, or history work can capture a
`replace_all` relative to the already-truncated checkpoint. Applying such a
mutation to the live transcript would remove the target as an incidental side
effect. The implementation must therefore keep separate working and
authoritative baselines rather than infer authority from a mutation's source.

### 2. Emit Patches From Committed Authority

`message_patch` should describe only data that the route actually committed or
an accepted user-message append already owned by the durable operation. Build
the client patch from the command result or a post-commit authoritative
snapshot/diff, not directly from the assembler's working mutation list.

Phase 0 must classify every existing mutation source:

| Source | Preliminary classification |
| --- | --- |
| `regenerate` | Prompt-only |
| `history_normalize` | Prompt-only |
| `run_var` message rewrite | Prompt-only unless a separate durable contract explicitly owns it |
| `user_message` | Authoritative after accepted append |
| `input_trigger` | Authoritative only when submit transcript persistence commits it |
| `editinput` | Authoritative only when submit transcript persistence commits it |
| `agent_preset` | Authoritative only when its transcript rewrite commits |
| `history_inject` | Authoritative only for identity-addressed committed injects |
| `start_trigger` | Audit and classify before cutover |
| `output_trigger` | Terminal-authoritative only |

The final classification must be backed by persistence tests. No source should
be sent to the browser merely because the working assembler recorded it.

Chat-variable, chat-metadata, character-field, and local-lore mutations should
follow the same rule: project them only after the owned write succeeds. They do
not need to share the transcript's `replace_all` representation.

### 3. Add a Transient Generation Projection Registry

Create a chat-scoped client registry, for example:

```ts
interface GenerationDisplayProjection {
  operationId: string
  attemptNo: number
  characterId: string
  chatId: string
  mode: 'send' | 'continue' | 'regenerate'
  targetMessageId?: string
  generationId?: string
  status: 'preparing' | 'streaming' | 'finalizing' | 'failed'
  text: string | null
  gapTruncated: boolean
}
```

For regenerate:

- register the projection as soon as the targeted operation is admitted;
- keep `text: null` during prompt assembly so the existing assistant remains
  visible with a regenerating/loading indicator;
- on the first cumulative token value, set `text` and render it over the target
  row without changing the authoritative `Message.data`;
- keep cumulative text in the projection during streaming and replay;
- remove the projection only after the authoritative terminal result has been
  applied and its generation/message identity is observable in the resource
  projection.

The registry must use operation ID plus attempt number as its freshness fence.
A late token, terminal, cancellation, or reattach frame from an older attempt
must not update the current projection.

### 4. Render Regenerate In Place

`Chats.svelte` should join the current chat's projection to the target message
row by `targetMessageId`. `Chat.svelte` should receive separate authoritative
and projected display inputs rather than a synthetic message in the chat array.

Conceptually:

```ts
const visibleData = projection?.text ?? message.data
const isRegenerating = projection?.mode === 'regenerate'
```

While `projection.text === null`, render the previous message body and a loading
status. Once text exists, render the streamed text in that same row. Editing,
translation, partial editing, copying raw source, TTS, and mutation controls
must continue to target the authoritative message and should be disabled when
the regenerate operation makes those actions unsafe.

Do not overwrite `Message.data`, `Message.chatId`, translation, generation info,
or prompt info with transient values.

### 5. Preserve a Stable Presentation Key

Server finalization replaces the target row with a generated message whose
stable message ID is normally the generation ID. The Svelte wrapper should not
be destroyed merely because authority changed IDs in the same logical
transcript slot.

Maintain a chat-mount-local presentation-key alias:

```text
target message ID -> logical row presentation key
generated message ID -> inherited logical row presentation key
```

Install the generated-ID alias before removing the transient projection. Clear
aliases on chat identity change, authoritative resync that changes row order, or
component destruction. The alias is disposable UI state and must not be
persisted.

If an alias cannot be proven fresh, prefer a safe remount plus explicit scroll
preservation over reusing component state for the wrong message.

### 6. Make Follow-Bottom Operation-Aware

Extend `ChatGenerationActivity` with at least:

```ts
mode: 'send' | 'continue' | 'regenerate'
targetMessageId?: string
generationId?: string
attemptNo?: number
```

`Chats.svelte` should own a follow record keyed by operation/attempt, not infer
regeneration from message count:

```ts
interface GenerationFollowState {
  operationId: string
  attemptNo: number
  follow: boolean
  userCancelled: boolean
}
```

On regenerate admission:

1. Record whether the transcript was at the latest position immediately before
   the operation. If product policy requires explicit reroll to always follow,
   set `follow` unconditionally; otherwise respect `autoScrollToNewMessage` and
   `alwaysScrollToNewMessage`.
2. Enter natural-end mode, set the latest-message spacer to zero, and set the
   reverse scroller to `scrollTop = 0` after the DOM flush.
3. Keep natural-end mode through target projection, streamed row growth, and
   the authoritative-ID handoff.
4. Ignore scroll events caused by the component's own spacer/key/size changes.
5. If a real user scroll moves away from the newest position, mark
   `userCancelled` and stop following.
6. On successful or retained-partial settlement, leave natural-end mode and run
   the normal latest-row alignment once.
7. On failure with the original row retained, restore the pre-operation spacer
   and latest-position state without manufacturing unread state.

Do not implement this as a fixed timeout. Parsing, images, streamed Markdown,
custom HTML, and mobile viewport changes can resize the row long after any
single timer fires.

### 7. Version the Cutover

Older clients currently rely on the regenerate removal patch followed by an
appended streaming row. Suppressing that patch for an old client would display
two assistant rows.

Add a client capability such as:

```text
regenerateTargetProjection: 1
```

When negotiated:

- the server omits prompt-only regenerate truncation from `message_patch`;
- the `info`/operation projection guarantees mode, target message ID,
  generation ID, operation ID, attempt number, and projection epoch;
- the client renders tokens through the transient target projection.

Without the capability, retain the current protocol until the compatibility
window closes. SSE event names remain additive-only; existing fields are not
renamed or removed.

## Lifecycle Requirements

### Successful Regenerate

1. Stage the targeted operation against the current assistant snapshot.
2. Register a preparing projection and follow state.
3. Assemble against a private transcript without the target.
4. Stream tokens into the target-row projection.
5. Finalize against the captured target snapshot.
6. Apply the authoritative generated row and reroll alternates.
7. Transfer the presentation key to the generated message ID.
8. Remove the transient projection and settle follow state.

### Failure Before Provider Output

- Remove the transient projection.
- Leave the authoritative target untouched.
- Do not send or apply a transcript restoration patch solely for regenerate;
  nothing authoritative was removed.
- Preserve the user's prior scroll/follow state.

### Non-Retaining Cancellation

- Discard transient text.
- Keep the original target and candidate buffer.
- Clear activity/projection state only for the matching attempt.

### Retained Partial Cancellation

- Finalize the partial through the server's authoritative generation write.
- Apply it through the normal terminal handoff.
- Persist the displaced original as a reroll alternate according to existing
  policy.

### Reattach and Replay Gaps

- Reconstruct the projection from the active job/operation record, including
  mode and target message ID.
- Reuse buffered cumulative partial text when available.
- Mark a replay gap explicitly; do not guess missing text from the visible
  authoritative target.
- If terminal authority is already resident, skip transient projection and
  settle directly.

### Navigation and Background Completion

- Projection registries remain chat-scoped.
- Navigating away must not cancel durable work.
- Navigating back joins the active projection to the hydrated target.
- Completion in another chat must not rebuild foreground rows, change geometry,
  or alter foreground unread state.

## Implementation Phases

### Phase 0 — Characterize and Classify

1. Add tests that capture the current regenerate assembly patch, stream append,
   terminal replacement, failure restoration, partial retention, and reattach.
2. Audit every `AssembleMutationSource` and document whether it is prompt-only,
   submit-authoritative, or terminal-authoritative.
3. Verify which mutations are actually persisted by
   `persistAssemblyMutations()` and which are only sent to the browser.
4. Add an end-to-end diagnostic assertion that a fresh regenerate currently
   changes the latest message ID without changing final list length.

Exit criterion: every outbound mutation has a named authority owner and a test.

### Phase 1 — Split Assembly Mutation Channels

1. Introduce separate working and authoritative mutation representations.
2. Make regenerate truncation working-only.
3. Build client patches from accepted persistence results.
4. Preserve existing legacy patch output behind capability negotiation.
5. Add server tests proving the SQLite target remains present until
   finalization and the new-capability client never receives its removal.

Exit criterion: new-capability server streams contain no prompt-only transcript
mutation.

### Phase 2 — Build the Client Projection Path

1. Extend generation activity and operation metadata with mode/target/attempt.
2. Add the transient projection registry and freshness guards.
3. Route streaming cumulative text into the registry for negotiated regenerate.
4. Keep the legacy synthetic-row path for non-negotiated sessions.
5. Reconstruct projections during reattach.

Exit criterion: projection unit tests pass without mutating the authoritative
message array.

### Phase 3 — Render and Handoff In Place

1. Join regenerate projections to their target rows in `Chats.svelte`.
2. Render loading and projected text in `Chat.svelte`.
3. Add stable presentation-key inheritance across terminal ID replacement.
4. Disable unsafe row actions while keeping raw-authority consumers correct.
5. Remove the projection only after authoritative terminal observation.

Exit criterion: the same mounted row wrapper survives prepare, stream, and
terminal handoff in DOM tests.

### Phase 4 — Integrate Scroll Lifecycle

1. Add operation-aware follow state.
2. Enter natural-end mode at regenerate admission.
3. Preserve it through projection growth and ID handoff.
4. Distinguish user scroll cancellation from internal geometry changes.
5. Settle through the existing latest-message alignment code.

Exit criterion: deterministic geometry tests keep `scrollTop = 0` while
following and preserve a user's manual history position after follow is
cancelled.

### Phase 5 — Cut Over and Remove Legacy Behavior

1. Enable the capability by default after server/client tests and browser smoke
   pass.
2. Keep metrics for legacy versus projection regenerate paths during the
   compatibility window.
3. Remove legacy regenerate transcript removal and synthetic stream append only
   after all supported clients negotiate the new path.
4. Update architecture and chat UI documentation.

## Test Plan

### Server Unit and Route Tests

- Regenerate working prompt excludes the target.
- The target remains in the authoritative initial/finalization snapshot.
- New-capability `message_patch` contains no regenerate truncation.
- A later prompt-only mutation cannot reintroduce the truncation through a
  `replace_all` suffix.
- Committed input-trigger/editinput/Agent-Preset/history-inject changes still
  reach the client exactly once.
- Failed persistence emits no authoritative projection patch.
- Finalization replaces the expected target and retains alternates.
- Stale/missing/ambiguous targets fail without projection corruption.

### Client State Tests

- Registering a regenerate projection does not mutate `chat.message`.
- First token, cumulative tokens, and final token update only the matching
  operation attempt.
- Old-attempt frames are ignored.
- Reattach reuses one projection and never appends a duplicate row.
- Failure restores the original presentation without a hydration requirement.
- Retained partial waits for terminal authority before dropping transient state.
- Candidate navigation remains independent from fresh regenerate projection.

### DOM and Scroll Tests

Add focused cases beside the existing latest-message alignment tests:

- A tall latest assistant remains mounted when regenerate starts.
- The loading state stays on that row before the first token.
- Streamed text grows and shrinks the row while `scrollTop` remains `0`.
- Spacer height remains zero during natural-end regenerate follow mode.
- Terminal message-ID replacement inherits the same presentation key.
- Completion exits natural-end mode and aligns once without a visible jump.
- Manual history scrolling cancels follow and is not undone at completion.
- `alwaysScrollToNewMessage` follows even when the pre-operation position was
  away from latest.
- Mobile scrollport-only resize does not move an overflowing regenerated row.
- In-flow and fixed composer modes both preserve the contract.

### Integration and Browser Coverage

- Durable regenerate success with real SSE streaming.
- Provider failure before tokens.
- Explicit Stop before tokens and after partial output.
- Disconnect and reattach during prepare, stream, and finalizing stages.
- Replay-gap recovery.
- Reload after completed regenerate reconstructs reroll alternates.
- Background-chat regenerate completion leaves foreground render-cost and
  geometry instrumentation unchanged.
- Legacy-capability browser continues to use the old path during rollout.

## Observability

Add content-free counters or trace fields for:

- negotiated regenerate projection version;
- prompt-only mutations suppressed from client patches;
- transient projection created, reattached, finalized, failed, and discarded;
- stale projection frames ignored;
- duplicate-row prevention;
- follow mode entered, user-cancelled, and settled;
- terminal handoff waiting time between authoritative patch and projection
  removal.

Never record message or streamed text in metrics.

## Likely File Ownership

Server:

- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/prompt/sseEvents.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/routes/generationOperations.ts`
- `server/fastify/src/messageStore.ts`
- generation route and prompt assembly tests

Client generation/protocol:

- `src/ts/process/generationActivity.svelte.ts`
- `src/ts/process/generationOperations.ts`
- `src/ts/process/request/serverChatEvents.ts`
- `src/ts/process/request/serverChat.ts`
- `src/ts/process/serverBackedSendChat.ts`
- `src/ts/process/postGeneration/streamResponse.ts`
- `src/ts/process/reattach.ts`
- a new chat-scoped generation display projection module

UI:

- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/lib/ChatScreens/Chats.svelte`
- `src/lib/ChatScreens/Chat.svelte`
- `src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`
- render-cost and custom-HTML tests where projected display affects parsing

Documentation:

- `src/docs/svelte-chat-ui.md`
- `src/docs/client-runtime.md`
- `docs/structure/backend.md`
- `docs/structure/data-and-events.md`

## Acceptance Criteria

The cleanup is complete when all of the following are true:

1. Fresh regenerate never removes the target from the authoritative browser
   message array before terminal finalization.
2. Prompt-only regenerate truncation is absent from new-capability client
   patches.
3. Exactly one assistant row is visible throughout prepare, streaming, terminal
   handoff, failure, cancellation, and reattach.
4. The logical row remains mounted across the generated message-ID handoff when
   freshness can be proven.
5. A following transcript remains at `scrollTop = 0` throughout regeneration
   and returns to normal latest-row alignment without a jump.
6. A user who scrolls into history is not forced back after cancelling follow.
7. Failure before retained output leaves the original assistant byte-for-byte
   intact and requires no compensating transcript restoration.
8. Retained partials and successful generations preserve existing alternate,
   translation, inlay, TTS, trigger, and finalization semantics.
9. Reattach and reload produce no duplicate or missing assistant rows.
10. Legacy capability behavior remains covered until its explicit removal.

## Recommended Patch Series

1. `test: characterize regenerate working versus visible transcript mutations`
2. `refactor: separate working and authoritative assembly mutations`
3. `feat: add regenerate target display projections`
4. `feat: render targeted regenerate streams in place`
5. `fix: keep regenerate projections at the transcript natural end`
6. `feat: negotiate regenerate projection protocol`
7. `test: cover regenerate failure cancellation reattach and browser scroll`
8. `docs: document targeted regenerate projection ownership`

Each commit should retain a working legacy path and include the focused tests
for the boundary it changes.
