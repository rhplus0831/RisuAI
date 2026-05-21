# sendChat Status

Date: 2026-05-21 (Phase 5 active through Phase 5-12)

Updated 2026-05-21: Phase 5 extraction is active. Commits
`3c5a92b2` through `d926228a` landed the first 12 slices:
auto-continue, owned `doingChat` lifecycle, error reporting,
desktop notification, IGP, stage-4 timing writeback, direct
response emotion, image-generation stable-diff dispatch, emotion
fallback helpers, output-trigger reuse, and the non-streaming plus
streaming response loops.

Phase 4 remains complete. The fixture harness (loader, provider
fake, snapshot, per-module mocks) plus all 17 target fixtures live
under `src/ts/process/__fixtures__/` and
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

`src/ts/process/index.svelte.ts` is currently 1713 lines. It is
still the main `sendChat` coordinator, but Phase 5 has pulled
several response and post-generation pieces into focused helpers.
The visible timing markers are:

- `stage1Start` at `src/ts/process/index.svelte.ts:257` -
  validation, lorebook prep, persona, description assembly.
- `stage2Start` at `src/ts/process/index.svelte.ts:995` - Hypa V3
  memory retrieval and prompt memory-card accounting. The current
  timing marker is narrower than the future Stage 2 module; the
  surrounding prompt assembly is still browser code.
- `stage3Start` at `src/ts/process/index.svelte.ts:1483` -
  provider dispatch via `requestChatData()`; inlay screen + TTS run
  after the first response chunk.
- `stage4Start` at `src/ts/process/index.svelte.ts:1637` -
  post-generation (auto-continue, emotion, stable diff, reroll
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
`streamResponse.test.ts`.

## Phase 4 landed

All target fixtures are in place. The list below documents what
each fixture pins.

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
  `src/ts/process/index.svelte.ts:1523` short-circuits the
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
  `src/ts/process/index.svelte.ts:1422` mutates the formated array
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
  the flag before re-entering. All 17 snapshots currently pin final
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
  `postGeneration/*`; the remaining work is to keep shrinking the
  coordinator until validation, prompt assembly, dispatch, and
  finalization are cleanly portable.
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
signature, plus the full 17-fixture suite after each slice.

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
