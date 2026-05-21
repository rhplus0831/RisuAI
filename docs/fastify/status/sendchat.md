# sendChat Status

Date: 2026-05-22 (Phase 5 active through Phase 5-25)

Updated 2026-05-22: Phase 5 extraction is active. The first 25
slices landed: auto-continue, owned `doingChat` lifecycle, error
reporting, desktop notification, IGP, stage-4 timing writeback,
direct response emotion, image-generation stable-diff dispatch,
emotion fallback helpers, output-trigger reuse, the non-streaming
plus streaming response loops, the final request-budget recheck,
the leading character-description system message, the non-template
main / jailbreak / globalNote sections, prompt-template
normalization (clone + implicit `postEverything` + utility-bot
override), the static prompt sections (author note,
chain-of-thought, persona, inlay-view instructions), the
lorebook placement context (`resolvePosition` / `positionParser`
closures plus normal / description / postEverything placements
and the depth-prompt filter), the template token preflight
(per-card token math, `memoryCardUsed` / `hasCachePoint` flag
discovery, no-template fallback that tokenizes every `unformated`
slot), the per-message history formatter (one `Message` →
`OpenAIChat` covering editprocess, inlays, multimodal +
caption fallback, sendName wrapper, Thoughts extraction, and
asset_prompt), the history assembly window (examples +
start-new-chat marker + first message + makeMs filter + start
trigger with stopSending early return + per-message loop + depth-
prompt token preflight), the memory window (Hypa V3 stage
transition with error writeback, fallback budget trim with
`lastMemory`, memory-card split, and `<Previous Conversation>`
wrapping), the final prompt render (12-card template walker,
non-template `formatingOrder` loop, automatic cache-point walk-back,
`pushPrompts` consecutive-system coalesce, `[Continue the last
response]` push, character `depth_prompt` splice, prompt-info text
capture, and the `editRequest` trigger), the provider dispatch
(stage-3 transition, preview / previewPrompt early returns,
`requestChatData` invocation, model-override propagation,
post-provider abort and fail handling), and the response
orchestration (streaming / non-streaming branch chooser,
`addRerolls`, shared output-trigger, streaming-only inlay + TTS,
auto-continue decision, IGP).

Phase 4 remains complete for the original 17 fixtures, and nine
narrow Phase 5 gate fixtures have since been added
(`prompt-template-basic`, `utility-bot-template`,
`lorebook-position-depth`, `prompt-template-memory-cache`,
`history-media-fallback`, `start-trigger-control`,
`start-trigger-stop`, `prompt-info-text`, `preview-prompt`) -
bringing the total to 26. All live under
`src/ts/process/__fixtures__/` and
`src/ts/process/__tests__/sendChat.fixtures.test.ts`. The fixtures
pin the entry path, every documented exit shape (success, multiline
reroll, upstream fail, abort, auto-continue recursion), the
prompt-shape variations under the default `formatingOrder` (author
note, automatic cache point, persona, keyword / constant /
recursive lorebook, multimodal image), hypaV3 memory consumption,
and both trigger transformation hooks (editRequest via
`runLuaEditTrigger`, editOutput via `customscript` regex). See
"Phase 4 landed" below for the per-fixture summary.

Snapshot schema bumped 2026-05-20: `providerCalls` now persists
the normalized call records (mode + formated + opt-in flags)
instead of a count. A later cleanup also added the final
`doingChat` boolean to every snapshot so the fixture harness pins
the owned lease reset. Existing fixtures were re-recorded.

## Current state

`src/ts/process/index.svelte.ts` is currently 558 lines. It is
still the main `sendChat` coordinator, but Phase 5 has pulled
several response and post-generation pieces into focused helpers.
The visible timing markers are:

- `stage1Start` at `src/ts/process/index.svelte.ts:248` -
  validation, lorebook prep, persona, description assembly.
- `stage2Start` inside
  `src/ts/process/promptAssembly/buildMemoryWindow.ts` - Hypa V3
  memory retrieval. The outer coordinator now passes
  `stageTimings` and a `setProcessStage` callback into the helper,
  which writes `stage1Duration`, `stage2Start`/`Duration` and
  flips the stage from 2 back to 1 around the `hypaMemoryV3`
  call. The fallback budget-trim branch (no Hypa V3) writes
  `stage1Duration` only.
- `stage3Start` inside
  `src/ts/process/dispatch/dispatchRequest.ts` - provider dispatch
  via `requestChatData()`. The helper writes `stage3Start` and
  flips the stage to 3; the coordinator no longer references
  `requestChatData` or `getGenerationModelString` directly.
- The streaming / non-streaming branch chooser, post-response
  output-trigger, streaming-only inlay + TTS, auto-continue
  decision, and IGP now live inside
  `src/ts/process/postGeneration/orchestrateResponse.ts`. The
  coordinator owns the auto-continue handoff itself (releases the
  `doingChat` lease and recurses into `sendChat`) so the helper
  avoids a circular import.
- `stage4Start` at `src/ts/process/index.svelte.ts:498` -
  post-generation (resend handoff, emotion, stable diff, reroll
  metadata).

It reaches into:

- `DBState` and `selectedCharID` (Svelte stores).
- Free functions in `src/ts/util.ts`, `src/ts/tokenizer.ts`,
  `src/ts/parser/chatML.ts`.
- `process/` submodules: `lorebook.svelte`, `scripts`,
  `triggers`, `exampleMessages`, `prereroll`,
  `memory/{hypamemory, hypav3}`, `transformers`, `inlayScreen`,
  `stableDiff`, `tts`, `request/request`.
- Phase 0 removed the `process/group`, `sync/multiuser`,
  `memory/{supaMemory,hypav2,hanuraiMemory}` imports and live
  branches.

Already extracted during Phase 5:

- `src/ts/process/autoContinue.ts` - `evaluateAutoContinue`.
- `src/ts/process/sendChatErrors.ts` - `reportSendChatError`.
- `src/ts/process/postGeneration/notification.ts` -
  `fireDesktopNotification`.
- `src/ts/process/postGeneration/igp.ts` - IGP dispatch.
- `src/ts/process/postGeneration/stage4Finalize.ts` - final
  stage-timing writeback to `generationInfo`.
- `src/ts/process/postGeneration/charEmotionStore.ts`,
  `emotionFromResponse.ts`, `emotionFallbackLlm.ts`, and
  `emotionFallbackEmbedding.ts` - emotion store and fallback paths.
- `src/ts/process/postGeneration/imggenStableDiff.ts` - image
  generation stable-diff dispatch.
- `src/ts/process/postGeneration/outputTrigger.ts` - shared
  output-trigger sequence after response application.
- `src/ts/process/postGeneration/nonStreamResponse.ts` and
  `streamResponse.ts` - non-streaming and streaming response loops.
- `src/ts/process/promptBudget/finalizeRequestBudget.ts` -
  post-`editRequest` token recheck + `outputTokens` estimate
  (discriminated `ok`/`overflow` result; `throwError` stays in
  the coordinator).
- `src/ts/process/promptBudget/preflightTemplateTokens.ts` -
  first prompt-template walker (the one that runs before history
  assembly and Hypa V3). Returns
  `{ addedTokens, memoryCardUsed, hasCachePoint }`. Handles both
  paths: templated (per-card token math + flag discovery) and
  no-template (tokenize every `unformated` slot). Reuses
  `systemizeChat` for the `chat` card under `sendChatAsSystem`.
- `src/ts/process/promptAssembly/buildDescription.ts` - leading
  character-description system message
  (`desc` + `additionalInformations` + `personality` + `scenario`).
- `src/ts/process/promptAssembly/buildPlainPromptSections.ts` -
  non-template main / jailbreak / globalNote sections, with the
  `@@role` / `@@@role` parser internal to the module.
- `src/ts/process/promptAssembly/normalizeTemplate.ts` -
  prompt-template cloning, implicit `postEverything` insertion,
  and utility-bot forced template. Returns
  `{ promptTemplate, usingPromptTemplate }`; `usingPromptTemplate`
  reflects the user's original choice (so the cot / template-only
  gates downstream still behave as before when the forced utility
  template is in play).
- `src/ts/process/promptAssembly/buildStaticPromptSections.ts` -
  four pure functions returning `OpenAIChat[]`: `buildAuthorNote`
  (chat note + template default fallback), `buildCotInstruction`
  (gated on `chainOfThought` + the
  `usingPromptTemplate && customChainOfThought` suppression),
  `buildPersona`, and `buildInlayViewInstruction` (emotion +
  imggen branches under `inlayViewScreen`). Each call site
  remains visible in `sendChat` so the relative `postEverything`
  ordering (cot before description/lorebook, inlay-view after)
  stays explicit.
- `src/ts/process/promptAssembly/buildLorebookContext.ts` -
  async helper that calls `loadLoreBookV3Prompt`, classifies the
  active entries, and mutates `unformated.lorebook` /
  `.description` / `.postEverything` in place. Returns
  `{ resolvePosition, positionParser, depthPrompts }` for the
  template walkers (`positionParser`) and the two coordinator-level
  depth-prompt loops (token preflight + history splice). The
  helper deliberately mutates the three slots in one pass because
  the placement order (descActives interleaved with
  `buildDescription`; assistant-prefill lore at the very end of
  postEverything) is intrinsic to the lorebook stage. Two
  pre-existing `console.log` calls dropped during the move.
- `src/ts/process/promptAssembly/systemizeChat.ts` - the role-to-
  system conversion used by template `chat` cards under
  `promptSettings.sendChatAsSystem` (and the `nameAdded` /
  `example_` exceptions). Moved out of `index.svelte.ts` during
  5-19 so the new preflight helper and the still-inline final
  render walker import from one place.
- `src/ts/process/promptAssembly/formatHistoryMessage.ts` -
  one-message conversion from `Message` to `OpenAIChat`. Handles
  `processScriptFull('editprocess', ...)`, `chatId` backfill,
  inlay stripping (with the char-vs-user branch), multimodal
  attachment (image / video first-wins / audio first-wins /
  signature unbounded), `runImageEmbedding` caption fallback for
  no-vision models, sendName wrapper, Thoughts extraction with
  `maxThoughtTagDepth` clamp, `{{asset_prompt::...}}` →
  `readImage`, and the empty-multimodals cleanup. The
  per-sendChat `findCharacterbyIdwithCache` cache is threaded as
  a callback. The unused `name` local is preserved because the
  call has the cache-population side effect that the sendName
  branch relies on.
- `src/ts/process/promptAssembly/buildHistoryWindow.ts` -
  the surrounding window machinery: `exampleMessage` +
  initial token cost, `[Start a new chat]` marker (gated by
  `aiModel.startsWith('novelai')` and `trimStartNewChat`),
  `makeMs` filter (handles `disabled: true` and
  `disabled: 'allBefore'` reset), first-message resolution from
  `firstMessage` / `alternateGreetings[fmIndex]` with
  `processScript('editprocess')` and the `sendName` prefix,
  `runTrigger('start', ...)` handling with stopSending early
  return and `setCurrentChat` on chat mutation, the per-message
  loop calling `formatHistoryMessage`, and the depth-prompt
  token preflight. Returns a stopped / non-stopped discriminated
  union carrying `{ chats, addedTokens, currentChat, triggerResult }`
  on success. The coordinator narrows with
  `if (history.stopSending === true)` because the project tsconfig
  has `strict: false`. The two pre-existing `console.log` debug
  calls that lived in this region were dropped during the move.
- `src/ts/process/promptAssembly/buildMemoryWindow.ts` -
  long-term memory + memory-card split. Branches on
  `nowChatroom.supaMemory && DBState.db.hypaV3`: the Hypa V3 path
  brackets a `hypaMemoryV3` call with stage timing transitions
  (`stage1Duration`, `stage2Start`, `stage2Duration`) and a
  `setProcessStage(2)`/`setProcessStage(1)` callback pair,
  persisting `hypaV3Data` summaries back into the supplied
  `currentChat` and `DBState.db.characters[selectedChar].chats[
  selectedChat]`. A HypaV3 error writes back any partial summary
  then short-circuits with `stopSending: true`. The fallback
  (non-Hypa) path runs a budget-trim while-loop, stops with
  `language.errors.toomuchtoken` if `chats.length <= 1` still
  exceeds budget, and records `currentChat.lastMemory`. Then the
  memory-card split rewrites `unformated.chats`: `supaMemory` /
  `hypaMemory` rows either get captured into the returned
  `memories[]` (when `memoryCardUsed`) and replaced with empty
  system placeholders that the trailing filter drops, or wrapped
  with `<Previous Conversation>…</Previous Conversation>`. All
  non-memory rows get `removable: true`. Without a prompt
  template the trailing chat is promoted to `unformated.lastChat`
  first. Returns a stopped / non-stopped discriminated union
  carrying `{ chats, currentTokens, currentChat, memories }`;
  the coordinator narrows with
  `if (memWindow.stopSending === true)`. Two pre-existing
  `console.log` debug calls that lived in the Hypa branch were
  dropped during the move.
- `src/ts/process/promptAssembly/renderFinalPrompt.ts` -
  the final prompt render. Owns the `pushPrompts`
  consecutive-system coalesce (gated on
  `gpt|claude|openrouter|reverse_proxy` model family), the
  `[Continue the last response]` push under the same gate, the
  full 12-card template walker (persona, description, authornote,
  lorebook, postEverything, plain, jailbreak, cot, chatML, chat,
  memory, cache), the non-template `formatingOrder` fallback, the
  automatic 3-deep `user`-role cache-point walk-back inside the
  `chat` card (gated on `automaticCachePoint && !hasCachePoint`),
  the explicit `cache` card depth walk, the final trim pass, the
  character `depth_prompt` splice at `length - depth`, and the
  `runLuaEditTrigger('editRequest', ...)` calls for both
  `formated` and (when prompt-info text capture is enabled)
  `promptBodyformatedForChatStore`. Returns
  `{ formated, promptText? }`; `promptText` is set only when both
  `promptInfoInsideChat` and `promptTextInfoInsideChat` are
  enabled. The coordinator attaches `promptInfo.promptText`
  conditionally. The helper takes a `positionParser` callback
  (from `buildLorebookContext`), a `memories` array (from
  `buildMemoryWindow`), and a `hasCachePoint` boolean (from
  `preflightTemplateTokens`). The
  `parseChatML`, `prebuiltAssetCommand`, `runLuaEditTrigger`, and
  `systemizeChat` imports moved out of the coordinator.
- `src/ts/process/dispatch/dispatchRequest.ts` - the provider
  dispatch boundary. Owns the stage-3 transition (`setProcessStage(3)`
  + `stageTimings.stage3Start`), the `arg.preview` early return,
  the `generationId = v4()` + `getGenerationModelString()` +
  `generationInfo` construction, the `requestChatData(...)`
  invocation with the full payload (formated, biasString,
  currentChar, useStreaming, isGroupChat, bias, continue, chatId,
  imageResponse, previewBody = `arg.previewPrompt`, escape,
  rememberToolUsage), the `req.model` override propagation into
  `generationInfo.model`, the `arg.previewPrompt + req.type === 'success'`
  preview-body early return, the post-provider `abortSignal.aborted`
  check, and the `req.type === 'fail'` early return. Returns a
  5-variant discriminated union (`preview` / `previewPrompt` /
  `aborted` / `failed` / `success`); the coordinator owns the
  module-level `previewFormated` / `previewBody` writes,
  the `throwError(reason)` on failure, and `generationInfo`
  attachment for both success and failed paths (the `failed`
  variant carries `generationInfo` so the error report can include
  it). The two pre-existing `console.log(req)` /
  `console.log(generationInfo.model, req.model)` debug calls were
  dropped during the move. The `v4` (uuid), `getGenerationModelString`,
  and `requestChatData` imports moved out of the coordinator
  (uuid stays only for the `chatId` backfill at line 205).
- `src/ts/process/postGeneration/orchestrateResponse.ts` - the
  post-dispatch response stage. Routes to `consumeStreamResponse`
  or `applyNonStreamResponse` on `req.type === 'streaming'`,
  applies the shared `applyOutputTrigger`, drives the
  streaming-only `runInlayScreen` + `sayTTS` side effects, runs
  `addRerolls` (conditionally on the non-stream branch when
  `mrerolls.length > 1`), evaluates `evaluateAutoContinue`, and
  runs `evaluateIgp`. Returns a 3-variant discriminated union
  (`aborted` / `continue` / `done`); the coordinator owns the
  auto-continue handoff (clears `doingChat`, resets
  `iOwnDoingChat`, recurses into `sendChat`) so the helper avoids
  a circular import on the exported `sendChat`. The
  streaming-branch asymmetry vs non-streaming branch is preserved
  verbatim: streaming reassigns local `currentChat` from
  `triggerChat`, while non-streaming writes `triggerChat`
  directly to `DBState.db.characters[selectedChar].chats[selectedChat]`
  without touching the local. The
  `consumeStreamResponse`, `applyNonStreamResponse`,
  `applyOutputTrigger`, `runInlayScreen`, `sayTTS`, `addRerolls`,
  `evaluateAutoContinue`, and `evaluateIgp` imports moved out of
  the coordinator (8 imports total).

The remaining Phase 5 work is tracked in
[`sendchat-slicing.md`](sendchat-slicing.md). Use that file as the
work picker: it maps the still-inline coordinator blocks to numbered
Phase 5 slices and lists the narrow fixture gates to add before
touching behavior the current 24 snapshots do not cover.

`src/ts/process/__tests__/sendChat.fixtures.test.ts` now drives a
fixture-based characterization harness:

- `src/ts/process/__fixtures__/loadFixture.ts` reseeds `DBState`
  via `setDatabase(...)` from a per-fixture `db/<name>.json`. The
  cleanup intentionally does not restore the prior `DBState.db`
  because doing so triggers a reactive `$effect` in
  `src/ts/parser/parser.svelte.ts:504-518` against partial state; the next
  fixture's `setDatabase()` reseeds wholesale.
- `src/ts/process/__fixtures__/providerFake.ts` is the fake for
  `requestChatData`. It scripts responses from
  `upstream/<name>.jsonl` and records every call. The test file
  installs it via `vi.mock('../request/request', ...)` so every
  importer (sendChat, stableDiff, triggers, scriptings, memory,
  mcp) routes through the same fake.
- `src/ts/process/__fixtures__/snapshot.ts` captures the final
  `messages`, the assistant `generationInfo`, the
  `chatProcessStage` write sequence, the spied side-effect call
  log, normalized provider call records, and the final
  `doingChat` value. It records to
  `expected/<name>.json` on first run (failing loudly) and asserts
  on every subsequent run. `UPDATE_FIXTURES=1` overwrites the
  recorded snapshot.
- The test mocks `inlayScreen`, `tts`, `stableDiff`, and
  `prereroll` modules so their side effects are recorded but no
  real work runs. UUIDs are deterministic
  (`uuid` mocked to a counter); time is locked via
  `vi.useFakeTimers({ toFake: ['Date'] })`.
- A small defensive guard was added to
  `src/ts/parser/parser.svelte.ts:506-507`
  (`selIdState?.selId ?? -1`, `DBState?.db?.characters?...`) so
  the top-level `$effect.root` does not throw at vitest's module
  teardown. This is a production-safe robustness change, not a
  refactor.

Existing `process/` helper-surface tests (TTS hooks, request
additional params, MCP Risu access modules, inlay asset helpers)
continue to cover older seams. Phase 5 adds targeted helper tests
for the extracted modules:
`sendChatErrors.test.ts`, `notification.test.ts`, `igp.test.ts`,
`stage4Finalize.test.ts`, `emotionFromResponse.test.ts`,
`charEmotionStore.test.ts`, `emotionFallbackLlm.test.ts`,
`emotionFallbackEmbedding.test.ts`, `imggenStableDiff.test.ts`,
`outputTrigger.test.ts`, `nonStreamResponse.test.ts`, and
`streamResponse.test.ts`, `finalizeRequestBudget.test.ts`,
`buildDescription.test.ts`, `buildPlainPromptSections.test.ts`,
`normalizeTemplate.test.ts`, `buildStaticPromptSections.test.ts`,
`buildLorebookContext.test.ts`, `preflightTemplateTokens.test.ts`,
`formatHistoryMessage.test.ts`, `buildHistoryWindow.test.ts`,
`buildMemoryWindow.test.ts`, `renderFinalPrompt.test.ts`,
`dispatchRequest.test.ts`, and `orchestrateResponse.test.ts`.

## Fixture Inventory

All current sendChat fixtures are in place. The list below documents
what each fixture pins.

- Scaffolding (loader, provider fake, snapshot harness,
  per-module mocks, test entry).
- `simple-send` - one user message, OpenAI, no lorebook / memory
  / triggers. Pins one streaming chunk being concatenated onto a
  new assistant row, plus `addRerolls` + `runInlayScreen` side
  effects and `chatProcessStage` writes `[1, 3, 4]`.
- `preview` - `sendChat(-1, { preview: true })`. Pins that
  `chatProcessStage` advances to `[1, 3]` and no provider call
  fires (`previewFormated` is populated then the function
  returns).
- `continue` - existing assistant message gets streamed text
  appended. Pins that no new message row is added; the existing
  `chatId` is preserved.
- `regenerate` - provider returns `type:'multiline'` with three
  entries. Pins that the first entry becomes the new char
  message, all three pass through `runInlayScreen`, and
  `addRerolls` receives the generationId plus the full array.
- `provider-error` - provider returns `type:'fail'`. With
  `inlayErrorResponse: true`, pins that `throwError` appends a
  `risuerror` fenced-block char message carrying the active
  `generationInfo`, stages stop at `[1, 3]`, and no side effects
  fire.
- `auto-continue` - `autoContinueMinTokens` set so a 1-token
  first response triggers the recursive call. Pins
  `stages: [1, 3, 0, 1, 3, 4]`, two `runInlayScreen` calls (the
  second with the concatenated text), two separate `addRerolls`
  calls (one per call), and the subtle behavior that the final
  message keeps the first call's `chatId` while
  `generationInfo.generationId` is overwritten by the second. The
  expanded `providerCalls` capture pins the second call's
  `formated` array: prior user message + assistant `"Cats"` row
  with `removable: true` + `"[Continue the last response]"`
  system marker, with `continue: true`.
- `author-note` - `chats[0].note` set. Pins that the note appears
  as the last system message in `formated` under the default
  `formatingOrder` (after the chat history, not at the documented
  "configured depth" - the real default is end-of-prompt).
- `cache-point` - `automaticCachePoint: true` with a
  `promptTemplate` that has a `chat` card. Pins that the
  walk-back marks the last three `user` entries with
  `cachePoint: true` and stops there. Without a `promptTemplate`,
  this branch is unreachable (it lives inside the `case 'chat'`
  switch of the template-driven prompt assembly).
- `prompt-template-basic` - custom template with `persona`,
  `description`, `authornote`, `plain`, `chatML`, and `chat`
  cards. Pins implicit `postEverything` insertion through the
  trailing chain-of-thought system message in `formated`.
- `utility-bot-template` - `utilityBot: true`, no user template,
  default `utilOverride: false`. Pins that the forced six-card
  utility template replaces the default `mainPrompt` /
  `globalNote`, shrinking `formated` to description plus history.
- `prompt-template-memory-cache` - template `memory` card wraps the
  Hypa V3 mock summary, and explicit `cache` card marks the
  intended user messages while suppressing automatic cache walk-back.
- `lorebook-position-depth` - six `globalLore` entries exercising
  `@@position before_desc`, `@@position after_desc`, `@@depth`,
  `@@reverse_depth`, named `@@position`, and
  `{{position::...}}`. Pins leading-system-block ordering and
  chat-history splice positions.
- `history-media-fallback` - no-vision model plus
  `{{inlay::test-image}}` user message. Pins mocked caption append
  and inlay tag stripping.
- `start-trigger-control` - start trigger mutates the chat history.
  Pins the injected user message in persisted history and in the
  provider `formated` payload.
- `start-trigger-stop` - start trigger returns `stopSending`.
  Pins `stages: [1]`, no provider calls, no side effects, no new
  assistant row, and final `doingChat: false`.
- `prompt-info-text` - enables `promptInfoInsideChat` +
  `promptTextInfoInsideChat` on a template with persona /
  description / authornote (with defaultText) / plain cards. Pins
  `messages[1].promptInfo.promptText` carrying the raw
  `innerFormat` strings (`'Persona: {{slot}}'`,
  `'Desc: {{slot}}'`, `'Note: {{slot}}'`) and the plain card's
  rendered content (`'Be concise.'`) after the `editRequest`
  trigger. `loadFixture.ts` re-applies
  `db.promptInfoInsideChat` / `db.promptTextInfoInsideChat`
  post-`setDatabase` because the web-mode default in
  `setDatabase` forcibly clears `promptInfoInsideChat` to false.
- `preview-prompt` - `sendChat(..., { previewPrompt: true })`
  with a non-streaming success upstream response. Pins
  `providerCalls[0].previewBody === true`, no new assistant
  message persisted, `stages: [1, 3]`, no side effects, and final
  `doingChat: false`. Together with `preview` (covers
  `arg.preview`), these two fixtures bound the two early-exit
  branches the dispatch helper owns.
- `persona` - `db.personaPrompt` set, no `chat.bindedPersona`.
  Pins that the content lands in `unformated.personaPrompt` and -
  under the default OpenAI-flavored `pushPrompts` consecutive-
  system merge - gets concatenated into the leading system
  message (after main and description). When the rendering target
  is not gpt/claude/openrouter/reverse_proxy, the merge does not
  happen and the persona becomes its own system entry.
- `lorebook-keyword` - one `globalLore` entry with `key: "cat"`,
  user message contains `cat`. Pins that the entry's content
  appears as the last system message under the default
  `formatingOrder` (the `lorebook` slot). The keyword match is a
  case-insensitive substring scan against the last
  `db.loreBookDepth` (default 5) messages.
- `client-abort` - test driver passes a pre-aborted
  `AbortSignal`. Provider fake does not honor the signal so the
  call is still captured, but the post-provider check at
  `src/ts/process/index.svelte.ts:843` short-circuits the
  function. Pins `stages: [1, 3]`, no assistant message added, no
  side effects.
- `lorebook-constant` - one `globalLore` entry with
  `alwaysActive: true` and no key. Pins that the content lands
  in `formated` purely by the always-on flag.
- `lorebook-recursive` - two `globalLore` entries chained by
  keyword: A keyed `cat` whose content mentions `sunbeam`, B
  keyed `sunbeam`. User message contains `cat`; A activates from
  the message, then the recursive scan picks up `sunbeam` from
  A's content and activates B. Both reach `formated` and the
  `pushPrompts` coalescer merges them into a single system block.
  Final order is `B then A` because the lorebook code sorts
  actives by `order` (insertorder) desc, then reverses - with A
  at 200 and B at 100, the reverse puts B first.
- `multimodal-image` - `{{inlay::test-image}}` tag in the user
  message; mocked `files/inlays` returns a 1x1 PNG. Uses a
  custom `xcustom:::test-vision-model` with `hasImageInput` and
  the `Unknown` tokenizer so `tikJS` runs offline. Pins that the
  inlay tag is stripped from message content and the base64
  lands in the OpenAIChat `multimodals` array. Bonus pin: with a
  model id outside the gpt/claude/openrouter/reverse_proxy
  family, `pushPrompts` does not coalesce consecutive system
  entries, so the main prompt and character description are two
  separate system messages instead of one.
- `hypav3-memory` - `character.supaMemory: true` and
  `db.hypaV3: true`. Mocks `memory/hypav3` via
  `vi.importActual` + override so `hypaMemoryV3` returns a
  canned `{ chats, currentTokens, memory }` with a prepended
  summary OpenAIChat (`memo: 'hypaMemory'`). Pins
  `stages: [1, 2, 1, 3, 4]` and that the summary entry survives
  into the formated prompt wrapped as
  `<Previous Conversation>...</Previous Conversation>`,
  immediately after the leading system block.
- `editrequest-trigger` - mocks `scriptings` wholesale (the
  real module imports wasmoon, which fails to initialize under
  happy-dom). The fake `runLuaEditTrigger` appends a marker
  system entry when the character has at least one
  triggerscript and the mode is `'editRequest'` on an
  `OpenAIChat[]`. Pins that the
  `runLuaEditTrigger('editRequest', formated)` call site at
  `src/ts/process/index.svelte.ts:757` mutates the formated array
  and the mutation reaches the provider.
- `editoutput-trigger` - one `customscript` regex of type
  `'editoutput'` rewriting `sunshine` -> `starlight`. Pins that
  the rewrite happens inside the streaming loop's extracted
  `processScriptFull('editoutput', ...)` call at
  `src/ts/process/postGeneration/streamResponse.ts:102` (before
  `runInlayScreen` sees the text), and the rewritten text is what
  gets persisted on the assistant message.
- `doingChat` is set to `true` only when `sendChat` owns the lease,
  and the owned lease is cleared in a `finally` block on every exit
  path. Recursive auto-continue / resend paths explicitly release
  the flag before re-entering. All 24 snapshots currently pin final
  `doingChat: false`; the test harness still resets it before each
  fixture defensively.
- The `uuid` mock counter resets between fixtures so snapshots
  are order-independent. Any new fixture that exercises a code
  path emitting multiple `v4()` calls should expect
  `uuid-0`, `uuid-1`, ... starting fresh.

## What lands when

- **Phase 4.** Fixture-driven characterization tests that pin the
  observable behavior of the current function. Inputs: canned
  database snapshots, canned chat state, canned upstream provider
  responses (fakes). Outputs: the message patches the function
  emits and the persisted chat shape.
- **Phase 5.** Per-stage extraction behind the fixtures. This is
  in progress. The landed module names are
  `autoContinue.ts`, `sendChatErrors.ts`, and
  `postGeneration/*`, `promptBudget/*`, and
  `promptAssembly/*`; the remaining numbered slices live in
  [`sendchat-slicing.md`](sendchat-slicing.md).
- **Phase 6.** Stage 3 dispatch moves server-side. Browser keeps
  a thin client that reads the server's SSE stream.
- **Phase 7.** Stage 2 prompt assembly moves server-side.
- **Phase 9.** Stages 1 + 4 move server-side; Stage 0 becomes a
  ~50-line bridge that owns the UI lease, abort forwarding, and
  side-effect dispatch.

## Boundary rules

Until Phase 5 closes, keep edits to `sendChat` narrow and
fixture-backed. Refactoring control flow belongs in small extraction
slices with targeted helper tests where the helper has a stable
signature, plus the full fixture suite after each slice.

## Reference: metatron's end state

`risuai-metatron`'s final sendChat is a 9-step browser handoff:

```
serverChatEntry.ts -> serverGenerationLifecycle.ts
  -> serverChatHandoff.ts -> sendServerBackedChat
  -> api/generate.ts -> POST /api/chats/{id}/generate (FastAPI)
  -> stream_generation -> validate / prompt / persist / provider / done
```

The TypeScript port targets a similar collapse but with Fastify
routes and the existing Svelte / SSE wiring. See
[`runtime-stages.md`](../runtime-stages.md) for the stage-by-stage
ownership map.
