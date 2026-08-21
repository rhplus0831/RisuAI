# Background Generation Completion Freeze — Implementation Plan

## Status

Implemented and verified on 2026-08-21. The focused resource, hydration,
terminal-patch, effect-ledger, and render-cost suites described below pass, as
does the repository-wide `pnpm test:all` release gate.

## Objective

Prevent a generation that completes in a background chat from briefly blocking
or repainting the chat the user is currently reading.

The implementation should make completion work proportional to the changed
chat and changed messages. It must preserve durable generation recovery,
revision ordering, reroll candidates, translations, unread indicators,
completion effects, and later navigation into the completed chat.

## Problem Summary

Normal generation completion is already narrow on the server:
`generation.persisted` identifies the changed chat and generated message, and
the browser fetches a generation-specific transcript suffix. The pause is
introduced primarily while applying and projecting that result in the browser.

The main sources of unnecessary foreground work are:

1. `getResourceDatabase()` implicitly reads one global
   `resourceDatabaseFacadeEpoch`. Any trusted write, including a write to a
   background chat, invalidates every mounted reactive `getDatabase()` consumer.
2. The visible transcript's row model reads the whole compatibility facade and
   the global generation-finalization array. A change for another chat can
   therefore rebuild the visible rows.
3. Generation suffix hydration allocates a replacement array proportional to
   the resident transcript length even when only one appended row changed.
4. The live terminal projection and the later authoritative command-event
   projection can perform semantically duplicate writes, producing multiple
   global reactive flushes close together.
5. The generation-specific hydration response includes chat-wide data such as
   Hypa state and reroll alternates even when those values did not change.
6. Configured completion effects, especially synchronous plugin callbacks or
   local embedding work, can add a separate main-thread long task.

## Non-Goals

- Do not weaken Fastify/SQLite authority or skip required revision/event
  reconciliation.
- Do not remove background generation, reattach, unread markers, terminal
  effects, or persisted reroll candidates.
- Do not replace the issue with an arbitrary debounce, timer, or loading
  overlay. The work itself must be reduced and scoped.
- Do not redesign the complete resource protocol in the first change.
- Do not add user-visible strings unless the final implementation introduces a
  new diagnostic surface.

## Required Invariants

- A completed background chat must be correct when opened later, including its
  final text, translation, generation metadata, reroll candidates, and Hypa
  state where applicable.
- `accepted`, `queued`, `committed_cleanup_pending`, stalled, terminal, and
  rejected generation persistence states must retain their existing meanings.
- Revision gaps, malformed events, database replacement, and replay exhaustion
  must continue to use the authoritative full-refresh fallback.
- Event-before-terminal and terminal-before-event races must converge on the
  same transcript without dropping newer user edits or stream projections.
- A background completion must not change foreground scroll alignment,
  automatic-translation eligibility, parser reload pointers, composer state, or
  reroll state.
- Active-writer loss and database-lineage fences must remain effective.
- The changes must work for both ordinary streaming and half-streaming, plus
  send, continue, regenerate, cancellation, reattach, and finalization recovery.

## Phase 0 — Add Reproduction and Cost Observability

Create a regression harness before changing behavior so the implementation can
distinguish fewer renders from merely faster machines.

### Work

- Extend `src/ts/__tests__/renderCostHarness.ts`, or add a focused companion
  harness, with:
  - one mounted foreground chat;
  - a second resident background chat;
  - a simulated `generation.persisted` suffix apply for the background chat;
  - configurable foreground and background transcript sizes.
- Add test-only counters or a small extracted pure helper so tests can observe:
  - visible `Chats.svelte` row-model builds;
  - `ChatBody`/`ParseMarkdown` invocations;
  - foreground geometry/scroll effects;
  - compatibility-facade epoch changes;
  - target transcript rows copied or allocated during range application.
- Cover both orderings:
  - terminal projection before the command event;
  - command event before the terminal projection.
- Record a baseline result without asserting a wall-clock duration. Prefer
  deterministic call/allocation counts for CI.

### Initial Acceptance Tests

- Applying a result to chat B leaves chat A's content and scroll position
  unchanged.
- The current implementation demonstrates at least one unnecessary foreground
  row-model invalidation, proving the harness exercises the bug.
- Parser counts remain separately visible so a row-model regression is not
  misreported as markdown parsing.

### Likely Files

- `src/ts/__tests__/renderCostHarness.ts`
- `src/ts/__tests__/renderCostHarness.test.ts`
- `src/ts/server/chatMessageHydration.reactivity.svelte.test.ts`
- `src/lib/ChatScreens/Chats.svelte`
- A new test-only or pure row-model helper if necessary

## Phase 1 — Scope Generation-Finalization Reactivity by Chat

Remove the guaranteed foreground transcript rebuild caused by publishing one
global finalization array.

### Work

- Keep the canonical flat generation-finalization list if bootstrap, polling,
  and recovery still benefit from it, but add a reactive chat-keyed projection.
  A `SvelteMap<string, readonly QueuedGenerationPersistence[]>` or individual
  per-chat stores is preferred.
- Update only the affected chat key in:
  - `setGenerationFinalizationPersistences()`;
  - `markGenerationPersistenceQueued()`;
  - `clearGenerationPersistence()`;
  - `acknowledgeHydratedGenerationPersistences()`.
- Do not publish any state when a clear/acknowledgement removed nothing and
  changed no entry.
- Expose a selector for the exact visible chat. `Chats.svelte` should consume
  that selector rather than `$generationFinalizationPersistences`.
- Build a message-id/generation-id lookup once per relevant chat projection
  instead of calling `Array.find()` for every visible message row.
- Preserve the existing flat-list compatibility export until all non-UI users
  are migrated or proven not to require it.

### Acceptance Criteria

- Clearing or acknowledging finalization state for chat B does not rebuild chat
  A's row model.
- A state change for chat A updates only the matching message indicator.
- Bootstrap replacement, periodic refresh, queued projection retention, and
  stalled/terminal states remain covered by existing tests.

### Likely Files

- `src/ts/process/generationPersistenceState.ts`
- `src/lib/ChatScreens/Chats.svelte`
- `src/ts/process/generationPersistenceState.test.ts`
- `src/lib/ChatScreens/Chats*.test.ts`

## Phase 2 — Remove Implicit App-Wide Facade Invalidation

Complete the resource-scoped reactivity boundary so a nested chat write does
not wake every `getDatabase()` caller.

### Preferred Design

- Stop reading `resourceDatabaseFacadeEpoch` implicitly inside
  `getResourceDatabase()`.
- Keep `getResourceDatabaseFacadeEpoch()` as an explicit compatibility signal
  for the small number of consumers that intentionally observe any database
  change.
- Rely on reads from `settingsResourceState`, `collectionsResourceState`, and
  `charactersResourceState`—including nested Svelte proxies—to register the
  actual reactive dependencies.
- Add narrow accessors where direct resource reads make ownership clearer, for
  example:
  - settings fields used by chat rendering;
  - the selected character row;
  - the selected chat body;
  - character-order and pinned-chat metadata.

### Migration and Audit

- Audit reactive callers of `getDatabase()` and `DBState.db` for code that
  depends only on receiving a new whole-database signal without reading a
  concrete field.
- Migrate any genuine broad observer to explicitly read the facade epoch.
- Prioritize mounted latency-sensitive surfaces:
  - `DefaultChatScreen.svelte`;
  - `Chats.svelte`;
  - `Chat.svelte`;
  - `ChatScreen.svelte` and `BackgroundDom.svelte`;
  - `Sidebar.svelte`, `SideChatList.svelte`, and pinned-chat projections;
  - the module-update root effect in `src/ts/stores.svelte.ts`.
- Consolidate repeated per-message renderer settings into a resource-backed
  renderer-settings projection where that reduces duplicate dependency work.
- Preserve an explicit compatibility mode temporarily if the audit finds a
  legacy whole-facade consumer that cannot be migrated in the same change. Do
  not make background chat writes conditionally non-reactive based only on
  visibility; ownership must be resource-based, not UI-state-based.

### Acceptance Criteria

- A trusted write to chat B invalidates subscribers to chat B and intentional
  whole-database observers, but not chat A's transcript or unrelated settings.
- A trusted write to chat A still updates its loading state, messages, parser
  inputs, and controls without an explicit global bump.
- Settings, collection, character-row, and selected-character updates still
  repaint their owning UI.
- Tests cover retaining the stable compatibility-proxy identity while reading
  newly replaced resource values.

### Likely Files

- `src/ts/server/resourceState.svelte.ts`
- `src/ts/storage/database.svelte.ts`
- `src/ts/stores.svelte.ts`
- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/lib/ChatScreens/Chats.svelte`
- `src/lib/ChatScreens/Chat.svelte`
- `src/lib/ChatScreens/ChatScreen.svelte`
- `src/lib/ChatScreens/BackgroundDom.svelte`
- `src/lib/SideBars/Sidebar.svelte`
- `src/ts/storage/database.resourceState.test.ts`
- `src/ts/server/resourceWriteGuard.test.ts`
- `src/ts/server/chatMessageHydration.reactivity.svelte.test.ts`

## Phase 3 — Make Transcript Suffix Application O(Delta)

Avoid copying a complete resident transcript for a small authoritative suffix.

### Work

- Extract the range merge in `hydrateServerChatMessages()` into a separately
  tested helper.
- For a safe append where `start === existing.length` and `total` matches the
  resulting length, append only the incoming rows.
- For an in-range replacement, assign only the affected indexes.
- Extend or truncate only when required by the authoritative `messageTotal`.
- Create placeholders only for genuinely missing indexes; do not rebuild
  existing placeholder or resident prefixes.
- Preserve object identity for unchanged messages so keyed rows and editor
  fences remain stable.
- Retain a conservative replacement fallback for malformed ranges or cases
  whose shape cannot be reconciled incrementally.
- Keep projection-epoch, mutation-intent, hydration freshness, and reroll fences
  around the merge.

### Race Cases to Test

- Append while an older range hydration is in flight.
- Continue/regenerate replacing a tail row.
- Authoritative truncation.
- A local message edit occurring before the generation suffix applies.
- A stream projection losing ownership to an authoritative apply.
- Loaded prefixes mixed with server-unloaded placeholders.
- Duplicate terminal/event delivery.

### Acceptance Criteria

- A one-message append performs work proportional to one row plus any required
  length adjustment, not the total transcript length.
- Unchanged message objects retain identity.
- The active chat and a later-opened background chat render the same canonical
  transcript as before.

### Likely Files

- `src/ts/storage/database.svelte.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/chatMessageHydration.test.ts`
- `src/ts/server/chatMessageHydration.reactivity.svelte.test.ts`

## Phase 4 — Make Terminal and Event Reconciliation Idempotent

Reduce clustered completion writes without weakening the authoritative event
contract.

### Work

- Introduce an exact completion projection record keyed by database lineage,
  chat ID, generation ID, message ID, and revision.
- When the live terminal applies `done.postGeneration.messagePatch`, record what
  was actually applied and the chat-body projection/mutation epochs that fenced
  it.
- When authoritative hydration arrives first, make the later terminal path
  verify the persisted message and skip assignments that are already
  semantically satisfied.
- When the terminal arrives first, continue processing the command event unless
  the terminal projection provides enough authority to acknowledge every field
  the event owns. Initially, use the completion record to make the range merge a
  no-op rather than skipping the server read.
- Only add a no-fetch local acknowledgement after the wire contract proves that
  the terminal contains the complete authoritative message/alternate state for
  that exact event revision.
- Ensure no-op assignments do not increment resource/facade epochs or publish
  stores.
- Expire projection records after the corresponding revision is reconciled or
  after bounded recovery cleanup.

### Acceptance Criteria

- Both event orderings produce one meaningful transcript mutation.
- Duplicate/replayed terminal or command events are no-ops.
- Newer local edits, regenerated candidates, and reattached attempts are never
  overwritten by an older completion record.
- Revision cursors still advance in strict contiguous order.

### Likely Files

- `src/ts/process/serverBackedSendChat.ts`
- `src/ts/process/postGeneration/streamResponse.ts`
- `src/ts/server/resourceInvalidation.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`
- `src/ts/server/resourceState.svelte.ts`
- A new narrowly owned completion-projection ledger module
- Existing server-backed send, reattach, resource invalidation, and accepted-send
  tests

## Phase 5 — Reduce Generation Hydration Payloads

After browser-side scoping is proven, reduce completion-time JSON parsing and
allocation.

### Work

- Document which table families can change for each finalization event shape:
  `generation` versus `chatTranscript`.
- For a plain `generation.persisted` event, omit chat-wide Hypa data when the
  event contract proves it was unchanged.
- Return reroll alternates only when finalization changed them, or add an
  explicit `alternatesIncluded`/`alternatesChanged` contract so omission cannot
  be confused with clearing.
- Preserve the broader `chatTranscript` path when scripts or chat state changed.
- Keep the fallback tail and full-chat reads for missing anchors, duplicate
  generation writes in one batch, and compatibility states.
- Update the client decoder so omitted, present-empty, and present-nonempty
  fields have distinct meanings.
- Add response-size instrumentation to the resource-read tests and protocol
  metrics.

### Acceptance Criteria

- A normal one-message completion response is proportional to its message delta
  plus explicitly changed alternate data.
- Omitted Hypa/alternate fields preserve resident state; explicit empty fields
  clear it only when authoritative.
- Legacy/pre-extraction fallback behavior remains correct.

### Likely Files

- `server/fastify/src/routes/resourceReads.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/messageStore.ts`
- `src/ts/server/hydrationReads.ts`
- `src/ts/server/resourceInvalidation.ts`
- `src/ts/server/chatMessageHydration.svelte.ts`
- Server and browser resource-read/invalidation tests

## Phase 6 — Isolate Conditional Completion Effects

Treat effect-related stalls as a separate performance class after the general
cross-chat invalidation is fixed.

### Work

- Add development-only timing around ledgered completion effects:
  notification, TTS, completion sound, emotion/image state, IGP, and plugin
  output.
- Confirm completion audio remains decoded during the user-activation unlock
  path and is not repeatedly decoded at terminal time.
- Move local emotion embedding/model inference off the main thread where the
  current backend permits it, or schedule it after the transcript/UI settlement
  with durable effect ownership retained.
- Add a browser yield before expensive best-effort visual effects if it does not
  violate the claim/lease window.
- Identify synchronous plugin output listeners that create long tasks. Prefer a
  worker/isolated runtime boundary for CPU-heavy plugin work; preserve stable
  idempotency keys and effect receipts.
- Do not mark an effect completed before its owned work actually succeeds.

### Acceptance Criteria

- With optional effects disabled, no completion-related long task remains.
- Enabling each effect identifies only that effect's cost rather than causing an
  unrelated transcript rebuild.
- Late recovery, effect claiming, lease renewal, and receipts remain correct.

### Likely Files

- `src/ts/process/generationEffectLedger.ts`
- `src/ts/process/serverBackedSendChat.ts`
- `src/ts/process/postGeneration/runStage4.ts`
- `src/ts/process/postGeneration/emotionFallbackEmbedding.ts`
- `src/ts/process/messageCompletionSound.ts`
- `src/ts/plugins/chatOutputListeners.ts`

## Verification Matrix

### Automated

- Unit tests for resource-facade fine-grained reactivity.
- DOM tests for foreground chat stability during a background completion.
- Generation-persistence selector tests for unrelated chat updates.
- Range-merge tests covering append, replace, truncate, placeholders, stale
  projections, and no-op replay.
- Resource invalidation tests for `generation`, `chatTranscript`, revision gaps,
  and duplicate events.
- Server resource-read tests for omitted versus explicit optional fields.
- Existing durable send, reattach, cancellation, finalization recovery,
  translation, reroll, and unread-marker suites.
- Performance gates using deterministic render/parse/allocation counts.

Run focused tests during each phase, then finish with the repository's standard
commands, including:

```sh
pnpm exec prettier --check .
pnpm test:all
```

Run `pnpm test:gates:perf` when the performance harness changes or when verifying
the final result.

### Manual

Use `pnpm dev:agent` with disposable data and stop it afterward.

Test at least these scenarios:

1. Start a generation in chat B, navigate to chat A, and continuously scroll or
   select text while B finishes.
2. Repeat with a long background transcript and a long foreground transcript.
3. Repeat for send, continue, regenerate, half-streaming, cancellation, and a
   reattached job.
4. Confirm B receives an unread indicator and opens with the correct final
   transcript and reroll state.
5. Repeat with Hypa enabled and with multiple reroll candidates.
6. Repeat with completion sound, TTS, emotion view, image generation, and
   plugins enabled one at a time.
7. Capture a browser performance profile around terminal completion and verify
   that no foreground transcript rebuild or long JSON/array-copy task remains.

## Delivery Sequence

Land the work in reviewable commits:

1. Regression harness and observability.
2. Chat-keyed generation-persistence projection.
3. Fine-grained resource-facade reactivity and latency-sensitive UI migration.
4. O(delta) transcript range application.
5. Terminal/event idempotence.
6. Optional hydration payload reduction.
7. Optional effect isolation and documentation updates.

Each commit should keep the application functional and its focused tests green.
Use conventional commit titles and include the required co-author trailer when
committing.

## Documentation Updates

After implementation, update:

- `src/docs/client-runtime.md` with the per-chat completion and projection
  reactivity contract;
- `src/docs/svelte-chat-ui.md` with foreground transcript subscription
  ownership;
- `docs/structure/server-resources-and-bridges.md` with generation delta/optional
  field semantics if Phase 5 changes the protocol;
- relevant test documentation if a new performance gate is added.

## Definition of Done

- Background completion does not rerun the visible chat's row model, parser, or
  geometry effects unless the visible chat itself changed.
- A normal appended completion applies in O(delta) client work.
- Terminal/event races and replay are idempotent.
- Durable recovery, revisions, effects, rerolls, translations, and unread state
  remain correct.
- Focused tests, performance gates, formatting, and `pnpm test:all` pass.
- A manual browser trace shows no perceptible input/scroll stall when a different
  chat finishes.
