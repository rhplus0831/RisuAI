# Rendering And Lifecycle Findings

## Chat Rows Are Manually Mounted And Not Updated

- Source:
  `src/lib/ChatScreens/Chats.svelte:63-154`
- Symptom:
  Existing visible chat rows can show stale names, avatars, roles, disabled
  state, or generation metadata after persona/character/chat updates.
- Why likely:
  `Chats.svelte` manually mounts `Chat` components with `mount()`. Existing
  component instances are never updated; they are only kept or removed based on a
  hash made from a subset of props.
- Remediation:
  Prefer a keyed `{#each}` over messages. If manual mounting remains necessary,
  include every render-affecting input in the key and update component props for
  retained instances.

## Chat Hash Omits Render-Affecting Props

- Source:
  `src/lib/ChatScreens/Chats.svelte:91-127`
- Symptom:
  A message can keep stale visual state even when the content is unchanged but
  surrounding display state changes.
- Why likely:
  The hash includes message data, chat id, index, portrait size, disabled state,
  and reload pointer, but omits values such as sender name, character name,
  images, role-derived display, `generationInfo`, and comment state.
- Remediation:
  Either remove the manual hash cache or extend it to cover all props that affect
  the rendered `Chat`.

## Custom HTML Renderer Drops Functional Attributes

- Source:
  `src/lib/ChatScreens/Chat.svelte:1388-1502`
- Symptom:
  Custom HTML theme images can render blank, and custom trigger buttons may not
  fire.
- Why likely:
  The renderer reconstructs allowed tags manually. `<img>` does not copy `src`,
  and `<button>` does not copy `risu-trigger`, `risu-btn`, or `risu-id`.
- Remediation:
  Copy a small allowlist of safe functional attributes for each reconstructed
  element, matching the sanitizer contract in `parser.svelte.ts`.

## Message Action Layout Reads `window.innerWidth` In Markup

- Source:
  `src/lib/ChatScreens/Chat.svelte:740-754`
- Symptom:
  Message action buttons do not switch between desktop/mobile layouts when the
  browser is resized.
- Why likely:
  `window.innerWidth` in markup is a one-off read and not tracked by Svelte.
- Remediation:
  Use CSS breakpoints for layout, or bind viewport width through
  `<svelte:window bind:innerWidth={...}>` / the existing size store.

## TextAreaInput Highlight Mode Can Throw On Selection State

- Source:
  `src/lib/UI/GUI/TextAreaInput.svelte:56-97`,
  `src/lib/UI/GUI/TextAreaInput.svelte:196-215`,
  `src/lib/UI/GUI/TextAreaInput.svelte:338-358`
- Symptom:
  Highlight/contenteditable inputs can throw during autocomplete or Enter-key
  handling when there is no selection range, the selection is outside the input,
  or the input has no text node.
- Why likely:
  The code calls `sel.getRangeAt(0)`, accesses `highlightDom`,
  `autoCompleteDom`, `inputDom`, and `div.childNodes[0]` without null/range
  guards.
- Remediation:
  Check `sel.rangeCount`, ensure the range belongs to `inputDom`, create a text
  node when needed, and no-op autocomplete until refs exist.

## TextAreaInput Highlight Mode Misses Input Side Effects

- Source:
  `src/lib/UI/GUI/TextAreaInput.svelte:338-353`
- Symptom:
  Highlighted/contenteditable fields can miss parent `onInput` side effects
  after paste, autocomplete insertion, or DOM text changes.
- Why likely:
  `onInput()` is called from `onkeydown` before the DOM text has changed, while
  the actual `oninput` handler only runs autocomplete.
- Remediation:
  Call `onInput()` from `oninput` after the bound text content has updated, and
  keep autocomplete guarded by the selection checks above.

## TextAreaInput Optimized Mode Delays Bound Value

- Source:
  `src/lib/UI/GUI/TextAreaInput.svelte:267-294`
- Symptom:
  Parent components can see stale text while the user is typing, especially for
  settings/search fields that assume two-way binding is immediate.
- Why likely:
  With `optimaizedInput` true, the component only assigns `value` every 11th
  input event or on change.
- Remediation:
  Use immediate binding by default for settings and command payload fields, and
  reserve throttled updates for expensive highlighting paths with a separate
  `onCommit`.

## TextAreaResizable Does Not React To Parent Value Changes

- Source:
  `src/lib/UI/GUI/TextAreaResizable.svelte:16-30`,
  `src/lib/UI/GUI/TextAreaResizable.svelte:33-38`
- Symptom:
  Autoresizing chat/editor fields can keep stale height when a parent replaces
  `value`, such as entering edit mode or loading cached translation text.
- Why likely:
  Height recalculation runs on mount and DOM input only. A Svelte `bind:value`
  update from the parent does not call `handleInput()`.
- Remediation:
  Add a reactive effect keyed on `value`, wait for `tick()`, then call
  `resize()` when the textarea ref exists.

## Popup Position Is Not Reactive To Resize

- Source:
  `src/lib/UI/PopupList.svelte:6-24`
- Symptom:
  A popup opened near an edge can stay incorrectly positioned after resizing the
  browser.
- Why likely:
  `styleString` reads `window.innerWidth` and `window.innerHeight`, which are not
  reactive dependencies.
- Remediation:
  Track viewport size through `SizeStore`, `<svelte:window>`, or a resize event
  state.

## Portal Effects Can Remount On Unrelated Changes

- Source:
  `src/lib/UI/GUI/Portal.svelte:10-22`
- Symptom:
  Portaled content can lose local state or event state if the parent re-renders
  and the effect is invalidated.
- Why likely:
  The effect mounts `PortalConsumer` and unmounts it whenever dependencies in
  the effect change. The props destructure is `const`, so target/children updates
  are not represented as explicit reactive state.
- Remediation:
  Mount once on component mount when possible, or key/remount explicitly by
  target while updating child content through normal Svelte composition.

## LazyPortal Observes The Target Instead Of A Sentinel

- Source:
  `src/lib/UI/GUI/LazyPortal.svelte:19-45`
- Symptom:
  Lazy portaled content may mount immediately or never mount depending on the
  target element and observer root.
- Why likely:
  The observer watches `target`, which defaults to `document.body`, not a local
  placeholder/sentinel representing where the content would be seen.
- Remediation:
  Observe a local sentinel element and portal only after that sentinel intersects
  the configured scroll root.

## Hypa V3 Memo Search Assumes Collapsed Refs Exist

- Source:
  `src/lib/Others/HypaV3Modal.svelte:116`,
  `src/lib/Others/HypaV3Modal.svelte:518-534`,
  `src/lib/Others/HypaV3Modal/modal-summary-item.svelte:628-641`
- Symptom:
  Searching for a chat memo/GUID can crash when the matching summary is
  collapsed.
- Why likely:
  `button.scrollIntoView()` assumes `summaryItemState.chatMemoRefs[memoIndex]`
  exists, but those refs are only bound while the summary is expanded. The modal
  initially collapses all summaries.
- Remediation:
  Expand the target summary, `await tick()`, then guard missing refs before
  scrolling or applying the highlight class.

## Realm Detail Popup Closes On Inner Clicks

- Source:
  `src/lib/UI/Realm/RealmPopUp.svelte:33-43`
- Symptom:
  Clicking inside a Realm detail popup can close it unexpectedly.
- Why likely:
  The backdrop closes on any bubbled click, and the inner panel does not stop
  propagation.
- Remediation:
  Close only when `event.target === event.currentTarget`, or stop propagation on
  the panel click handler.

## Realm Upload Mode Buttons Toggle The Wrong State

- Source:
  `src/lib/UI/Realm/RealmUpload.svelte:156-168`,
  `src/lib/UI/Realm/RealmUpload.svelte:188-194`
- Symptom:
  The "Update" / "Upload Newly" selection does not affect the upload payload and
  can toggle NSFW mode instead.
- Why likely:
  Both handlers write `nsfwMode`, while the UI ring and submit payload use
  `update`.
- Remediation:
  Set `update = false` and `update = true` in those handlers.

## Realm Upload Validates Stale Creator Notes

- Source:
  `src/lib/UI/Realm/RealmUpload.svelte:30`,
  `src/lib/UI/Realm/RealmUpload.svelte:80`,
  `src/lib/UI/Realm/RealmUpload.svelte:177-194`
- Symptom:
  Edited creator notes can validate against stale text, and invalid notes can
  still upload.
- Why likely:
  `creatorNotes` is parsed once at component initialization, while the editor
  binds `char.creatorNotes`. Validation reads the stale parsed object and does
  not return after `alertError()`.
- Remediation:
  Parse `char.creatorNotes` at submit time and return early on validation
  failure.

## RealmFrame Ping Loop Has No Cancellation

- Source:
  `src/lib/UI/Realm/RealmFrame.svelte:49-61`,
  `src/lib/UI/Realm/RealmFrame.svelte:63-109`,
  `src/lib/UI/Realm/RealmFrame.svelte:127-129`
- Symptom:
  Realm upload can spin forever, and the ping loop can continue after closing
  the modal if the iframe never replies.
- Why likely:
  `waitPing()` loops until `pongGot` with no timeout or destroyed flag, while
  `onDestroy` only removes the message listener.
- Remediation:
  Add a timeout/abort flag checked inside the loop and set it from `onDestroy`.

## Plugin Alert Continue Action Is Hidden In Details

- Source:
  `src/lib/Others/PluginAlertModal.svelte:40-58`
- Symptom:
  "Continue Anyway" is hidden behind nested details/dev-info disclosure.
- Why likely:
  The continue button is inside two nested `<details>` elements.
- Remediation:
  Keep developer info inside a single `<details>` and render both decision
  buttons outside it.

## NewGUI Button Has Missing Branches And Events

- Source:
  `src/lib/UI/NewGUI/Button.svelte:4-12`,
  `src/lib/UI/NewGUI/Button.svelte:17-91`
- Symptom:
  A default or `color="secondary"` NewGUI button renders no button, and callers
  cannot attach click handlers.
- Why likely:
  Only `primary` and `danger` branches are rendered, `color` has no default, and
  rest props/events are not forwarded to the `<button>`.
- Remediation:
  Add a default/secondary branch and forward button attributes/events through
  rest props.
