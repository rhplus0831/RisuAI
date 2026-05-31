# Chat UI Findings

## Direct Transcript Writes During Send

- Source:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:190-263`
- Symptom:
  Sending a message in Fastify/server-backed mode can throw
  `Cannot mutate read-only server projection` before generation starts, or can
  race with the server command that should own the transcript.
- Why likely:
  `currentChatRecord.message` is aliased to `cha`, mutated with `push()`, then
  assigned back before `dispatchReplaceMessages()`. In Fastify mode normal UI
  code should not mutate projected chat messages directly.
- Remediation:
  Build a cloned message array, pass that through the chat command helper, and
  perform any optimistic local write inside `withTrustedServerProjectionWrite()`
  only after deciding the exact command boundary.

## Send Result Is Treated As Success

- Source:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:286-313`,
  `src/ts/process/index.svelte.ts:55-431`
- Symptom:
  A stopped, aborted, or failed generation can still clear the reroll boundary,
  record a generated reroll, mark reroll character state, and play the send
  sound.
- Why likely:
  `sendChat()` returns `false` on many abort/failure paths, but
  `sendChatMain()` awaits it without checking the boolean before running success
  side effects.
- Remediation:
  Store `const ok = await sendChat(...)` and only clear reroll state, record
  generated rerolls, and play success audio when `ok === true`.

## Durable Reattach Stop Handle Drift

- Source:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:284-301`,
  `src/ts/process/reattach.ts:50`
- Symptom:
  After reload-resuming a durable generation, the visible stop button can do
  nothing.
- Why likely:
  The UI-owned `abortController` is created in `DefaultChatScreen`, while the
  reattach flow calls `sendChat()` outside that controller path.
- Remediation:
  Move the active generation cancel handle into shared process state, or route
  reattach through the same controller/cancel path used by the visible chat UI.

## First-Message Greeting Swipes Mutate Chat State

- Source:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:890-918`
- Symptom:
  Greeting swipe buttons can fail under the projection guard or revert after a
  projection refresh.
- Why likely:
  `chat.fmIndex` is mutated directly on the selected chat and then assigned back
  to `DBState.db.characters[...]`.
- Remediation:
  Update via `dispatchUpdateChat(chat.id, { fmIndex }, previous)` and keep any
  optimistic assignment inside the trusted projection-write helper.

## Auto-Suggestions Race The Selected Chat

- Source:
  `src/lib/ChatScreens/Suggestion.svelte:49-129`
- Symptom:
  Suggestions can appear on the wrong chat after the user switches chats while
  the request is in flight, or fail under the projection guard.
- Why likely:
  The async request captures `currentChar`, but writes through live
  `$selectedCharID` and `currentChar.chatPage` after resolution, then mutates
  `suggestMessages` directly on projected chat state.
- Remediation:
  Capture stable character/chat ids before the request, ignore stale responses,
  and persist suggestions with `dispatchUpdateChat()`.

## Chat Asset Picker Mutates Character Assets

- Source:
  `src/lib/ChatScreens/AssetInput.svelte:40-54`
- Symptom:
  Adding sticker/assets from the chat input can fail in Fastify mode or not
  persist consistently.
- Why likely:
  The component mutates `currentCharacter.additionalAssets` directly, but the
  prop is a projected character object.
- Remediation:
  Clone the character or asset array and persist through `setCharacterByIndex`
  or `dispatchUpdateCharacter()`.

## Pending Inlay Preview Can Crash

- Source:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:762-798`,
  `src/ts/process/files/inlays.ts:163-167`
- Symptom:
  Pending file previews can crash if an inlay asset was deleted, expired, or
  missing from local storage.
- Why likely:
  `getInlayAsset()` can return `null`, but the `{#await}` result immediately
  reads `inlayAsset.type`.
- Remediation:
  Add a null branch in the await result and render a recoverable missing-file
  state with a remove action.

## Screenshot History Load Is Not Stabilized

- Source:
  `src/lib/ChatScreens/DefaultChatScreen.svelte:419-471`
- Symptom:
  Chat screenshots can omit older messages and then reduce the visible history
  to 10 messages after completion.
- Why likely:
  `loadPages = Infinity` is not followed by `await tick()` before querying the
  DOM, and the previous value is not restored in `finally`.
- Remediation:
  Save the old `loadPages`, `await tick()` before querying `.risu-chat`, and
  restore the saved value in `finally`.
