# Svelte Chat UI Guide

Last audited: 2026-08-17.

This guide owns the visible chat frame, transcript, message rows, composer
variants, generation/loading feedback, and in-chat confirmations. Return to the
[architecture index](../../docs/structure/README.md) for cross-layer ownership
or the [Svelte UI guide](svelte-ui.md) for the application shell.

## Fast Triage

| Symptom | Inspect first | Then inspect |
| ------- | ------------- | ------------ |
| Chat frame, background, or display mode is wrong | `src/lib/ChatScreens/ChatScreen.svelte` | `src/lib/ChatScreens/BackgroundDom.svelte`, `src/styles.css` |
| Transcript window, hydration, scroll, composer, or menu is wrong | `src/lib/ChatScreens/DefaultChatScreen.svelte` | `src/lib/ChatScreens/DefaultChatScreen.loadPages.ts`, `src/ts/server/chatMessageHydration.svelte.ts` |
| One message, translation, parser result, or partial edit is wrong | `src/lib/ChatScreens/Chat.svelte`, `src/lib/ChatScreens/ChatBody.svelte` | `src/lib/ChatScreens/ChatBodyParseMemo.ts`, `src/lib/ChatScreens/PartialEditController.svelte` |
| Generation text, progress bar, stage color, or cancel state is wrong | `src/lib/ChatScreens/chatGenerationLoading.ts`, `Chat.svelte`, `DefaultChatScreen.svelte` | `src/ts/process/index.svelte.ts`, durable generation state in [Client Runtime](client-runtime.md) |
| Draft/BTW hook controls or review state are wrong | `src/lib/SideBars/ChatDraftHookSelector.svelte`, `src/lib/ChatScreens/InputHookPickerDialog.svelte`, `DefaultChatScreen.svelte` | [Translation And Input Hooks](../../docs/structure/translation-and-input-hooks.md) |

## Chat Surface Ownership

`src/lib/ChatScreens/ChatScreen.svelte` frames the surface. It switches among
standard, waifu, and mobile-waifu display modes, applies background and text
screen styles, renders `BackgroundDom`, and opens chat/module modals.

`DefaultChatScreen.svelte` coordinates the active character and chat, message
hydration, transcript window, scroll-to-message work, the composer and attached
files, suggestions and stickers, send/continue/reroll actions, generation and
hook cancellation, and chat quick menus. Active transcript rendering fans out
through `Chats.svelte`, `Chat.svelte`, and `ChatBody.svelte`. `Message.svelte`
is only an unmounted props stub and is not part of the live row-rendering path.

Plugin V3 chat panels render in `DefaultChatScreen.svelte` inside the same chat
content column. Plugin floating actions and chat-menu registrations are owned by
[Plugins And MCP](../../docs/structure/plugins-and-mcp.md#ui-surfaces).

## Transcript Hydration And Paging

Character root resources contain message-less chat rows. Before treating an
empty transcript as a render failure, inspect
`src/ts/server/chatMessageHydration.svelte.ts`. The open chat shows a loading
state until its messages arrive and a retryable error state after failed
hydration.

`src/ts/chatLoadPages.ts` normalizes two durable Advanced settings:
`chatLoadInitialPages` controls the initial resident tail and
`chatLoadAdditionalPages` controls each ordinary expansion. Their defaults are
30 and 15. `DefaultChatScreen.svelte` reads both helpers, resets to the
configured initial count when the chat identity changes, and adds the
configured additional count for the new-message expansion control. Message
jumps and input-hook history can request a larger bounded window instead.
Server defaults and migration normalization live in
`server/fastify/src/databaseDefaults.ts`; UI definitions live in
`src/ts/setting/advancedSettingsData.ts`.

`ScrollToMessageStore`, transcript-window identity, image-load waits, folded
message state, and route freshness all affect scroll behavior. A queued bookmark
jump expands and hydrates the necessary window only after its target route is
current. `DefaultChatScreen.loadPages.test.ts`, `src/ts/chatLoadPages.test.ts`,
`src/ts/setting/advancedSettingsData.test.ts`, and
`src/ts/server/chatMessageHydration.test.ts` guard this boundary.

On chat entry, `Chats.svelte` waits for the newest persisted row to render and
aligns that row's start with the transcript scrollport's start. A measured
trailing spacer supplies only the reverse-scroll range needed for short newest
rows. While the transcript remains pinned to the newest content, a
`ResizeObserver` remeasures that spacer as the newest row grows or shrinks so a
previously aligned row cannot leave stale blank space behind. A resize of only
the scrollport (the mobile keyboard opening or closing) instead preserves a
transcript resting at its natural end, since re-asserting start alignment
there would scroll away from the end of an overflowing newest row. A newly appended
empty assistant placeholder instead stays at the reverse scroller's natural
end throughout that streaming turn, avoiding a delayed loading-indicator jump
to the top; chat-entry and explicit new-message alignment remain available.
Manual scrolling away from the newest content cancels live alignment; empty
chats retain their ordinary greeting/composer layout.

## Message Rendering

`Chat.svelte` owns each persisted row's controls and display state.
`ChatBody.svelte` renders parsed content, while `ChatBodyParseMemo.ts` owns
parser/LLM-detection memoization and dependency signatures for character, chat,
modules, settings, CBS state, and reload epochs. Stale HTML or unexpectedly
expensive rerenders often start at that memo boundary.

Supported `ChatBody` parses negotiate server-owned intermediate display
processing without moving HTML rendering. `Chat.svelte` supplies the stable
message id and original/translation/bilingual layer; `ChatBody.svelte` carries
those through the existing parse memo; and `ParseMarkdown()` sends the
post-first-asset source through the same-chat batch bridge. Pending parses keep
the last successful body. On a cold transcript mount, `Chats.svelte` keeps the
chat-content loading cover visible until the newest two rows' first display
parses settle; later reparses continue showing their last successful bodies.
An empty hydration shell starts that cold-display cycle only if persisted rows
arrive. Once hydration confirms that the chat is empty, its display is ready and
the first subsequently sent message does not reopen the cover. An authoritative
re-stub or resync can start a new cycle.
The cover stays below the app-owned responsive sidebar dialog so opening
navigation remains usable while the chat finishes rendering.
Plugin hooks and unsupported surfaces transparently run the former all-client
path, while raw message, translation, copy, edit, TTS, and prompt sources remain
unchanged.

`Chats.svelte` matches writer-scoped generation-finalization state by stable chat,
message, and generation ids. `Chat.svelte` renders queued, transiently stalled,
terminal, and quarantined legacy indicators on that exact row; committed rows
whose journal cleanup remains pending are not described as provisional.
`DefaultChatScreen.svelte` likewise matches Stop controls to the exact active
operation or job. A settled control retained from an older send cannot hide Stop
for a newer live continue or regenerate job.

The visible `Chats.svelte` row model subscribes only to the current chat's
finalization projection and the nested resource fields it renders. The flat
bootstrap/recovery finalization list is not a UI dependency. Background-chat
completion must leave the foreground row-model build counter, parser calls, and
geometry effects unchanged; `renderCostHarness.test.ts` guards both
terminal-before-event and event-before-terminal orderings.

Message HTML crosses parser output, translation, custom HTML templates, inlays,
additional/module assets, and optional partial edit. Parser code lives under
`src/ts/parser/`, while file and inlay processing lives under
`src/ts/process/files/`. `src/ts/parser/parser.svelte.ts` emits `x-hl-lang` and
`risu-ctrl="bgm___..."` markers. `src/ts/observer.svelte.ts` turns highlighted
code into copy/download context targets, starts BGM, retries blocked autoplay on
the next user activation, and stops playback on chat change.
`src/ts/observer.svelte.test.ts` guards that DOM contract. Runtime parser
ownership remains in the
[client TypeScript map](client-runtime.md#client-typescript-areas).

Persisted generated-message translations are server-raw. The terminal
generation frame can carry the final automatic translation result, and
`src/ts/process/serverGeneratedMessageTranslation.ts` mirrors success or joins
the existing job UI for running/failure states. `Chats.svelte` grants one-shot
client eligibility only to other appended rows under the chat's automatic
translation policy. `Chat.svelte` renders bilingual display through
`x-risu-bilingual-translation` blocks. When automatic translation is enabled,
an existing persisted translation is displayed for either role; the bot-only
setting prevents new user-message translation requests without hiding stored
user-message translation data.

`src/lib/ChatScreens/ChatBody.svelte` retains the legacy client-only HTML
translation path for synthetic greetings and non-persisted preview rows that
have no server-raw target. Eligibility follows the active chat's
automatic-translation and bot-only policy; persisted transcript rows do not use
this fallback.

The synthetic greeting row (`idx === -1`) uses the separate manual projection
in `src/ts/server/greetingTranslations.svelte.ts`.
`src/lib/ChatScreens/Chat.svelte` renders that projection and
`src/lib/ChatScreens/DefaultChatScreen.svelte` supplies its target and state.
Persisted greeting projections do not become automatic merely because chat
auto-translation is enabled.

Partial block/text editing belongs to `PartialEditController.svelte`. Its
match-selection, delete-confirmation, and failure dialogs share the modal focus
and backdrop actions; stale target guards prevent a result from applying after
the active message changes.

Partial edits route to the text layer the touched block renders from
("edit what you see"): the original message, the persisted raw translation in
translated view, or either side of a bilingual pair
(`src/lib/ChatScreens/partialEditLayer.ts` resolves the layer; bilingual pair
wrappers and cross-side drag selections are rejected). Translation-layer saves
persist through the same message-translation patch as the manual translation
editor, and a result that trims to nothing removes the translation.
Original-layer partial saves deliberately keep the persisted translation
(unlike whole-message edit mode, which still nulls raw translations), so a
line fix under translated or bilingual display never drops the translation.
Freshness guards compare against the corresponding live layer text.

On touch devices, a long-press on a block
(`src/lib/ChatScreens/partialEditTouchTrigger.ts`, gated by the same
block-partial-edit setting) reveals the hover edit/delete buttons, swallows
the synthetic click that follows release, and suppresses native long-press
text selection inside the message body while the gesture is active. Outside
taps dismiss the buttons via a macrotask-attached listener.

## Composer Layout Modes And Mobile Viewport

The composer owns five reload-recoverable fields: message, translated message,
attached files, reviewed Draft output, and BTW output.
`DefaultChatScreen.composerDrafts.ts` retains them per transcript in bounded,
lineage/writer-scoped `sessionStorage`. Only an accepted save for the exact
draft generation clears recovery. The complete storage contract is in
[Client Runtime](client-runtime.md#draft-recovery-stores).

One Svelte snippet owns the composer row, draft-persistence and generation
recovery banners, Draft/BTW output, translation, attachments, stickers,
suggestions, and generation controls. `fixedChatTextarea` chooses where that
surface renders. A true value renders the snippet in the persistent dock outside
the reverse transcript scroller. A false or missing value renders it as the
first child of that scroller, which places it at the content bottom in normal
flow. With `floatingChatInput` enabled (the default), scrolling far enough toward
older messages reveals a pencil button in the bottom-right. Activating the
button temporarily restyles that same mounted surface as a fixed floating card;
returning to the bottom restores flow, and explicitly hiding the card returns
to the pencil button. The fixed dock always gates floating presentation off.
Switching fixed/in-flow modes may remount the
snippet, but its transcript-scoped state remains owned by
`DefaultChatScreen.svelte` and its recovery store.

The dock is a nonshrinking sibling of the transcript and caps unusually tall
composer content with its own scroll area. It has no independent background
fill: the chat column's text-screen overlay tints the transcript and composer
uniformly. Accessibility exposes both the baseline `fixedChatTextarea` placement
and the default-on `floatingChatInput` companion for in-flow mode.

`DefaultChatScreen.svelte` measures the rendered content column with
`ResizeObserver`. The transcript, active composer surface, and overflow menu
share that width across `chatScreenWidth`, viewport changes, and safe-area
insets. In-flow menus are positioned inside the transcript containing block;
dock-mode menus retain the column-root containing block. Floating cards and
menus use `--chat-content-fixed-inline-end`; its measurement accounts for custom
`backdrop-filter`, which makes the chat root the containing block for fixed
descendants. Normal and translated textareas clamp to a 44-pixel minimum, while
the floating textarea is capped at `min(40dvh, 18rem)`.

While a text editor is focused, `visualViewportCoordinator.ts` publishes only
the visual viewport height to the app shell. The shell stays at page origin and
is never translated from `pageTop` or `offsetTop`. The dock therefore lands at
the bottom of the keyboard-reduced shell. In-flow mode relies on the reverse
transcript scroller staying at `scrollTop = 0` while its height contracts, so a
focused composer at the content bottom also remains above the keyboard. If the
user then scrolls toward history while the keyboard is open and floating input
is enabled, the bottom-right pencil appears; activating it turns the same
composer into a floating card. Window-fixed cards add the difference between
the layout viewport and
`--risu-visual-viewport-height` to their bottom inset; the custom
`backdrop-filter` containing-block case is already shell-relative and does not
add that offset. The card and pencil button therefore stay inside the
keyboard-reduced shell. After a focused viewport settles more than 100 pixels
below the full window height, the coordinator caches that height in device-local
storage under an orientation-specific portrait or landscape key. On a later
focus with no current adjustment, a sane cached height is applied synchronously
before the keyboard reveal and the document scroll guard is notified through
the normal apply path. This pre-lift usually places the composer inside the
future keyboard viewport before WebKit needs to pan it.

Initial focus and every viewport geometry event also restart a 275-millisecond
stability latch. A cache-miss session stays unclamped while geometry is moving;
a pre-lifted session keeps its cached clamp active and uses motion only to
restart the timer. The settled measurement then reconciles any cache drift and
updates the cache when it still represents a real keyboard-sized reduction. A
stale pre-lift used with a hardware keyboard is restored to the measured full
height at this checkpoint. The coordinator then invokes the document scroll
guard to pin root scroll to zero. A 700-millisecond trailing validation catches
late iOS drift. Focusout continues to hold the last applied height for 700
milliseconds before release, while keyboard-close events use the same stability
debounce.

`index.html` requests `interactive-widget=resizes-content`, allowing supporting
Android browsers to reduce the layout viewport directly; iOS ignores the key
and uses the same height-only coordinator. To observe real-device pan channels,
enable the passive viewport overlay with `?risuViewportDebug=1` or the
`risu-viewport-debug=1` local-storage flag. It never changes viewport state.

## Generation And Loading States

`src/lib/ChatScreens/chatGenerationLoading.ts` maps process stages to localized
labels and bounded progress. The visible sequence covers starting, preparing
the prompt, checking memory, waiting for the model, finalizing, and stage `5`
for input hooks. `Chat.svelte` renders the message-row loading track, while the
composer cancel button mirrors the same stage colors. Message-generation stage
and cancellation state come from the open chat's entry in
`generationActivity.svelte.ts`, so another chat can generate concurrently
without replacing the visible state of this one.

Both the placeholder loading row and the half-streaming row use `w-full`, so
they fill the message content width instead of stopping at the former fixed
34-rem cap. The surrounding transcript/content column still enforces the user's
configured chat width.

Draft and BTW hook execution registers a chat-keyed activity in
`src/ts/process/inputHookActivity.svelte.ts`. Each entry owns stage `5`, its
abort controller, hook kind, and composer-operation token/version; different
chats may run concurrently while one chat remains single-flight. The progress
fill and composer spinner are amber (`#f59e0b`), and ID-scoped cleanup prevents
one hook from clearing another chat's state. Stage mapping is covered by
`chatGenerationLoading.test.ts`, the registry by `inputHookActivity.test.ts`,
and the DOM behavior by `DefaultChatScreen.loadPages.test.ts`.

`AgentPresetProgress.svelte` and `PostGenerationScriptProgress.svelte` mount
above the transcript in the shared content column. Their visible snapshots are
chat-scoped. Agent execution and completeness belong to
[Agents And Presets](../../docs/structure/agents-and-presets.md), while durable
send, cancellation, and reattach belong to [Client Runtime](client-runtime.md).
Visible generation starts in `DefaultChatScreen.svelte`, while durable send and
reattach live under `src/ts/process/`.
When the outer reattach budget is exhausted, the composer replaces its healthy
pulse with a warning and renders a separate accessible alert. Its Retry,
Refresh, and Stop controls pass the failed job ID rather than selecting work by
chat, and the accepted-send recovery alert remains an independent state
machine.
`src/ts/process/rerollNavigation.svelte.ts` owns reroll operation fencing and
keeps the selected assistant authoritative while its targeted regenerate is
admitted. Server assembly removes that row only from the working prompt, and
generation finalization atomically replaces it while retaining reroll
alternates. A failed regenerate therefore needs no browser transcript rollback.

Settling a chat-keyed message generation records a bounded, consume-once marker
in `src/ts/process/chatSuggestionCompletion.svelte.ts`. `Suggestion.svelte`
consumes only the open chat's marker: persisted suggestions satisfy it without
a request, resident empty chats request once, and empty shells retain it until
their transcript hydrates. Request ownership is also chat-keyed, so duplicate
mounted consumers cannot start the same automatic suggestion request.

## Input-Hook Chat Controls

`src/lib/SideBars/ChatDraftHookSelector.svelte` selects a chat-scoped Draft
hook. `src/lib/ChatScreens/InputHookPickerDialog.svelte` selects an ad hoc BTW
hook whose result can be retained or dismissed independently of the message.
Draft review, Translation mode presentation, floating conversion, and the
amber running state are chat UI responsibilities. Execution starts in
`src/ts/process/inputHooks.ts`. Supported prompt slots are `{{slot::content}}`,
`{{slot::draft}}`, `{{slot::history::N}}`, and
`{{slot::historytrans::N}}`, where `N` is bounded to 1–50.

A Draft hook's optional Translation mode preserves the review step. Sending
uses the reviewed result as the user message and stores the original composer
text in its source-bound translation field. History requests expand the
resident transcript tail only as far as required and share the translator
history boundary: disabled/comment rows, the greeting fallback, persisted
translations, chronological ordering, and the common token budget. Hook model
resolution and the complete slot, history, translation, and execution contract
belong to
[Translation And Input Hooks](../../docs/structure/translation-and-input-hooks.md).

## In-Chat Confirmations

Message removal in `Chat.svelte` captures a stable character/chat/message
target before awaiting. Depending on `askRemoval`, `instantRemove`, and modifier
state, the UI can confirm removal and then choose between deleting only the row
or truncating the transcript at that row. Strict hydration supplies a missing
preceding message ID before a server-backed truncation. Partial edits have their
own preview and delete confirmation in `PartialEditController.svelte`.

The server-backed send path also handles the non-Hypa context-truncation
warning. Despite the historical field name, Fastify asks only when prompt
assembly truncated history, combined Hypa V3/Supa memory is not active, and the
chat has not acknowledged the warning. A generation request can return the 409
protocol code
`hypa_context_truncation_confirmation_required`. The UI asks with
`language.hypaContextTruncationConfirm`; acceptance durably patches that chat's
`hypaContextTruncationAcknowledged` field, waits for actual acceptance, verifies
that the same chat still owns the operation, and retries generation once.
Decline, acknowledgement failure, abort, or chat change does not retry. The
field is allowed by both `src/ts/chatCommands.ts` and
`server/fastify/src/commands/chats.ts`; behavior is covered in
`src/ts/process/__tests__/sendChat.serverPreview.test.ts`.

## Focused Tests

Start with `src/lib/ChatScreens/DefaultChatScreen.loadPages.test.ts`,
`src/lib/ChatScreens/ChatBody.svelte.test.ts`,
`src/lib/ChatScreens/ChatBody.parseMemo.test.ts`,
`src/lib/ChatScreens/Chat.parserDependencies.test.ts`,
`src/lib/ChatScreens/BackgroundDom.parserDependencies.test.ts`,
`src/lib/ChatScreens/Chat.customHtml.test.ts`,
`src/lib/ChatScreens/PartialEditController.sharedHover.test.ts`,
`src/lib/ChatScreens/partialEditFreshness.test.ts`,
`src/lib/ChatScreens/partialEditLayer.test.ts`,
`src/lib/ChatScreens/partialEditTouchTrigger.test.ts`,
`src/lib/ChatScreens/chatButtonTriggerFreshness.test.ts`,
`src/lib/ChatScreens/Suggestion.svelte.test.ts`, and
`src/lib/ChatScreens/newMessageTranslationEligibility.test.ts`.

Translation, input-hook, and observer guards include
`src/ts/translator/bilingualInterleave.test.ts`,
`src/ts/translator/bilingualInterleave.dom.test.ts`,
`src/ts/process/inputHooks.test.ts`,
`src/ts/process/serverGeneratedMessageTranslation.test.ts`, and
`src/ts/observer.svelte.test.ts`. The visible-state policy is canonical in
[Testing And Operations](../../docs/structure/testing-and-operations.md#visible-state-test-contract).
