# Svelte Chat UI Guide

Last audited: 2026-08-09.

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

## Message Rendering

`Chat.svelte` owns each persisted row's controls and display state.
`ChatBody.svelte` renders parsed content, while `ChatBodyParseMemo.ts` owns
parser/LLM-detection memoization and dependency signatures for character, chat,
modules, settings, CBS state, and reload epochs. Stale HTML or unexpectedly
expensive rerenders often start at that memo boundary.

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
`x-risu-bilingual-translation` blocks.

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

## Composer And Floating Composer

The composer owns five reload-recoverable fields: message, translated message,
attached files, reviewed Draft output, and BTW output.
`DefaultChatScreen.composerDrafts.ts` retains them per transcript in bounded,
lineage/writer-scoped `sessionStorage`. Only an accepted save for the exact
draft generation clears recovery. The complete storage contract is in
[Client Runtime](client-runtime.md#draft-recovery-stores).

When `floatingChatInput` is enabled (the default) and `fixedChatTextarea` is
off, scrolling farther than the greater of 24 pixels or half the normal
composer height promotes the existing composer into an expanded floating
overlay. The user can collapse it to an icon, reopen it, return to the bottom,
or hide it. Chat changes and disabling the preference clear the floating state;
opening, hiding, and toggling views preserve the current draft.

If the active chat has a selected Draft hook and a nonblank reviewed Draft, the
floating composer initially shows that Draft read-only and replaces Send with a
Convert toggle. Convert exposes the editable original message; edits remain
authoritative across toggles and after closing the overlay.

`DefaultChatScreen.svelte` measures the rendered content column with
`ResizeObserver`. The normal and floating composers, trigger, and overflow menus
use its width and inline-end variables across `chatScreenWidth`, custom fixed
containing blocks, viewport changes, and safe-area insets. Normal and translated
textareas clamp to a 44-pixel minimum and remeasure after the floating overlay
opens.

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

Draft and BTW hook execution temporarily sets stage `5`. Its progress fill and
composer spinner are amber (`#f59e0b`); each hook restores the stage it replaced
in `finally`, but only if no other work has changed it. Stage mapping is covered
by `chatGenerationLoading.test.ts` and the DOM behavior by
`DefaultChatScreen.loadPages.test.ts`.

`AgentPresetProgress.svelte` and `PostGenerationScriptProgress.svelte` mount
above the transcript in the shared content column. Their visible snapshots are
chat-scoped. Agent execution and completeness belong to
[Agents And Presets](../../docs/structure/agents-and-presets.md), while durable
send, cancellation, and reattach belong to [Client Runtime](client-runtime.md).
Visible generation starts in `DefaultChatScreen.svelte`, while durable send and
reattach live under `src/ts/process/`.
`src/ts/process/rerollNavigation.svelte.ts` owns reroll operation fencing and
failed-regenerate rollback, including restoring a displaced assistant tail only
when newer transcript work has not superseded it.

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
