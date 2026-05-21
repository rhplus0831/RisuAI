# sendChat Remaining Slice Plan

Date: 2026-05-21

This shard is the work picker for the rest of Phase 5. Phase 4 is
still closed: the 17 landed fixtures remain the baseline safety net.
Landed Phase 5 gates have raised the active snapshot count to 24.
The "Phase 4 gates" below are targeted fixture additions to land
immediately before a Phase 5 slice touches an uncovered behavior.

The intent is to keep agents from choosing only tiny helpers while
also avoiding one oversized "finish sendChat" task. Pick the first
open slice below; if its fixture gate is not satisfied, land that
gate first, then land the extraction slice. Update this file and
[`next-steps.md`](next-steps.md), then move on.

## Current Code Map

`src/ts/process/index.svelte.ts` is 637 lines. Phase 5-1 through
5-24 already extracted auto-continue, owned `doingChat` lifecycle,
error reporting, response loops, most post-generation helpers, final
request-budget recheck, character description, plain-prompt main /
jailbreak / global-note sections, prompt-template normalization
(clone + implicit `postEverything` + utility-bot override), the
static prompt sections (author note, chain-of-thought, persona,
inlay-view), the lorebook placement context (`{{position::...}}`,
injection lore, normal / description / postEverything placements;
returns `resolvePosition`, `positionParser`, and `depthPrompts`),
the template token preflight (per-card token math plus the
`memoryCardUsed` / `hasCachePoint` flag discovery, plus the no-
template path that tokenizes every `unformated` slot), the
per-message history formatter (one `Message` → `OpenAIChat`:
editprocess script, name resolution, inlay/multimodal/caption
fallback, sendName wrapper, Thoughts extraction, asset_prompt), the
history assembly window (examples + start-new-chat + first
message + makeMs filter + start-trigger handling with stopSending
early return + per-message loop + depth-prompt token preflight),
the memory window (Hypa V3 stage transition with error writeback,
fallback budget trim with `lastMemory`, memory-card split, and
`<Previous Conversation>` wrapping), the final prompt render
(12-card template walker, non-template `formatingOrder` loop,
`pushPrompts` consecutive-system coalesce, `[Continue the last
response]` push, automatic cache-point walk-back, character
`depth_prompt` splice, prompt-info text capture, and the
`editRequest` Lua trigger), and the provider dispatch (stage-3
transition, preview / previewPrompt early returns, `requestChatData`
invocation with full payload, model-override propagation,
post-provider abort and fail handling; 5-variant discriminated
union return).

The work still inside the coordinator is clustered here:

| Lines   | Remaining responsibility                                                                                                      | Target owner after Phase 5           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 91-257  | Entry guard, preset-chain switch, selected character/chat setup, prompt-info seed, tokenizer setup.                           | `sendChatContext` / lifecycle helper |
| 360-390 | Depth-prompt history splice and `triggerResult.additonalSysPrompt` distribution (`promptend` / `historyend` / `start` slots). | prompt render helper (or its setup)  |
| 469-571 | Stream vs non-stream orchestration, output-trigger result, inlay / TTS side effects, auto-continue and IGP.                   | response orchestration helper        |
| 576-630 | Resend handoff, notifications, emotion fallback routing, image generation dispatch, final timing writeback.                   | stage-4 orchestrator                 |

## Phase 4 Fixture Gates

Do not reopen Phase 4 as a broad task. Add one fixture only when the
next extraction slice would otherwise move behavior that snapshots do
not cover.

| Gate                                | Add before                                 | Fixture behavior to pin                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F4-A `prompt-template-basic`        | Template normalization or render slices.   | Landed 2026-05-21. Template with `persona`, `description`, `authornote`, `plain`, `chatML`, `chat`, no explicit `postEverything`. `chainOfThought: true` so the implicit `postEverything` insertion is observable as the trailing cot system message in `formated`.                                                                                                                                                                                                                                                                                 |
| F4-B `prompt-template-memory-cache` | Memory-window or template cache slices.    | Landed 2026-05-21. Template with `memory` (innerFormat: `"Memory: {{slot}}"`) and `cache` (depth: 2, role: 'user') cards, Hypa V3 mock memory, and `automaticCachePoint: true`. Pins that the memory card wraps the canned summary as a system entry with `memo: 'hypaMemory'`, the cache card marks msg-user-3 and msg-user-4 with `cachePoint: true`, and the automatic walk-back is suppressed (msg-user-2 stays unmarked).                                                                                                                      |
| F4-C `lorebook-position-depth`      | Lorebook placement slices.                 | Landed 2026-05-21. Six globalLore entries exercising `@@position before_desc`, `@@position after_desc`, `@@depth 1`, `@@reverse_depth 1`, `@@position pt_<name>`, and a `{{position::<name>}}` reference; snapshot pins the leading-system-block ordering, the chat-history splice positions, and end-to-end `resolvePosition`.                                                                                                                                                                                                                     |
| F4-D `history-media-fallback`       | History formatting slices.                 | Landed 2026-05-21. User message `"Look: {{inlay::test-image}}"` on `xcustom:::no-vision-model` (no `LLMFlags.hasImageInput`). Mocks `runImageEmbedding` to return `[{ generated_text: 'fake caption' }]`. Pins the caption append + inlay strip path. The `{{asset_prompt::icon}}` part of the original scope is deferred: `vi.mock` cannot reliably intercept `.svelte.ts` modules in this vitest setup, so the `readImage` mock needed for icon assets is dropped here and unit-tested with the `{{asset_prompt::missing}}` no-op branch instead. |
| F4-E `start-trigger-control`        | Start-trigger / history collection slices. | Landed 2026-05-21 as a pair: `start-trigger-control` (mutation) and `start-trigger-stop` (early return). A vi.mock on `../triggers` uses importActual and overrides `runTrigger` to dispatch on `triggerscript[0].comment` markers (`__test_start_mutate` / `__test_start_stop`). Existing fixtures with no triggerscript flow through to the real impl unchanged.                                                                                                                                                                                  |
| F4-F `prompt-info-text`             | Prompt-info or template-render slices.     | Landed 2026-05-21. Enables `promptInfoInsideChat` + `promptTextInfoInsideChat` on a template with persona / description / authornote (defaultText) / plain cards. Pins `messages[1].promptInfo.promptText` after `editRequest` - raw `innerFormat` strings (`Persona: {{slot}}`, `Desc: {{slot}}`, `Note: {{slot}}`) plus the plain card's rendered content (`Be concise.`). `loadFixture.ts` re-applies `db.promptInfoInsideChat` / `db.promptTextInfoInsideChat` post-`setDatabase` because the web-mode default in `setDatabase` forcibly clears `promptInfoInsideChat` to false. |
| F4-G `preview-prompt`               | Dispatch slices.                           | Landed 2026-05-22. `sendChat(..., { previewPrompt: true })` with a non-streaming success upstream. Pins `providerCalls[0].previewBody === true`, no new assistant message persisted, `stages: [1, 3]`, no side effects, `doingChat: false`.                                                                                                                                                                                                                                                                                                         |
| F4-H `utility-bot-template`         | Template normalization slices.             | Landed 2026-05-21. `utilityBot: true` with no `promptTemplate` and default `utilOverride: false`. Pins that the forced 6-card template replaces the default `mainPrompt` / `globalNote`, so `formated` shrinks to description + history only.                                                                                                                                                                                                                                                                                                       |

## Phase 5 Remaining Slices

Keep each slice large enough to retire a real responsibility from
`index.svelte.ts`, but small enough to review as one commit. Targeted
unit tests are expected when the extracted helper has a stable public
signature; otherwise the fixture gate plus the full sendChat fixture
suite is the acceptance test.

| Slice                               | Status          | Scope                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Fixture gate                                                                                                                                      |
| ----------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5-16 Template normalization         | done 2026-05-21 | Extracted prompt-template cloning, implicit `postEverything`, and utility-bot override into `src/ts/process/promptAssembly/normalizeTemplate.ts`. The coordinator call site at `index.svelte.ts:274` destructures `{ promptTemplate, usingPromptTemplate }`. No rendering moved.                                                                                                                                                                                                                                                                                                 | F4-A, F4-H (both landed)                                                                                                                          |
| 5-17 Author/persona/static sections | done 2026-05-21 | Extracted author note (with template default fallback), chain-of-thought instruction, persona prompt, and inlay-view `postEverything` instructions into `src/ts/process/promptAssembly/buildStaticPromptSections.ts` as four pure functions returning `OpenAIChat[]`. The coordinator now stages each push at the correct point in the `unformated` assembly.                                                                                                                                                                                                                    | Existing fixtures cover author note and persona; `buildStaticPromptSections.test.ts` adds 16 focused cases for cot gates and inlay-view branches. |
| 5-18 Lorebook placement context     | done 2026-05-21 | Extracted `loadLoreBookV3Prompt()` plus the `resolvePosition` / `positionParser` closures, normal / description / postEverything lore placements, and the depth-prompt filter into `src/ts/process/promptAssembly/buildLorebookContext.ts`. Helper mutates the three relevant `unformated` slots and returns `{ resolvePosition, positionParser, depthPrompts }` for the downstream walkers and the two depth-prompt loops (token preflight + history splice). Two leftover `console.log` calls dropped.                                                                         | F4-C (landed)                                                                                                                                     |
| 5-19 Template token preflight       | done 2026-05-21 | Extracted the first prompt-template walker into `src/ts/process/promptBudget/preflightTemplateTokens.ts`. Returns `{ addedTokens, memoryCardUsed, hasCachePoint }`. Handles both the templated and no-template paths. The local `systemizeChat` helper was moved to `src/ts/process/promptAssembly/systemizeChat.ts` so both the preflight helper and the still-inline final render walker can import it from one place.                                                                                                                                                         | F4-A, F4-B (both landed)                                                                                                                          |
| 5-20 History message formatter      | done 2026-05-21 | Extracted the inner per-message loop body (originally ~150 lines in `sendChat`) into `src/ts/process/promptAssembly/formatHistoryMessage.ts`. The helper takes `{ msg, index, totalCount, currentChar, usingPromptTemplate, findCharacterbyIdwithCache }` and returns the assembled `OpenAIChat`. The coordinator loop becomes a 4-line wrapper that calls the helper, pushes onto `chats`, and tokenizes. The per-sendChat `findCharacterbyIdwithCache` cache stays in the coordinator and is threaded as a callback. The unused `name` local is preserved (cache side effect). | F4-D (landed; asset_prompt branch deferred per fixture note)                                                                                      |
| 5-21 History assembly window        | done 2026-05-21 | Extracted examples, `[Start a new chat]` marker, first message, `makeMs` filter (disabled / allBefore), start-trigger handling with stopSending early return, per-message loop calling the 5-20 formatter, and the depth-prompt token preflight into `src/ts/process/promptAssembly/buildHistoryWindow.ts`. Returns a stopped / non-stopped discriminated union carrying `{ chats, addedTokens, currentChat, triggerResult }` on success; the coordinator narrows with `history.stopSending === true` because the project has `strict: false`.                                   | F4-E (landed)                                                                                                                                     |
| 5-22 Memory window                  | done 2026-05-21 | Extracted the Hypa V3 stage transition (with `setProcessStage` callback + `stageTimings` mutation + DB writeback of `hypaV3Data`), fallback budget trim with `language.errors.toomuchtoken` stop, `currentChat.lastMemory` capture, memory-card split (returns `memories[]` for the downstream `'memory'` template card), and the `<Previous Conversation>` wrap into `src/ts/process/promptAssembly/buildMemoryWindow.ts`. Returns a stopped / non-stopped discriminated union carrying `{ chats, currentTokens, currentChat, memories }`; the coordinator narrows with `memWindow.stopSending === true`. Two pre-existing `console.log` debug calls dropped during the move. F4-B fixture pins the Hypa happy path; the `hypaMemoryV3` import moves out of the coordinator. | F4-B (landed)                                                                                                                                     |
| 5-23 Final prompt render            | done 2026-05-21 | Extracted the 12-card template walker (persona / description / authornote / lorebook / postEverything / plain / jailbreak / cot / chatML / chat / memory / cache), the non-template `formatingOrder` fallback, the `pushPrompts` consecutive-system coalesce, the `[Continue the last response]` push, the automatic 3-deep `user`-role cache-point walk-back (gated on `automaticCachePoint && !hasCachePoint`), the explicit `cache` card depth walk, the final trim pass, the character `depth_prompt` splice, and the `editRequest` Lua trigger (for both `formated` and the prompt-info text capture buffer) into `src/ts/process/promptAssembly/renderFinalPrompt.ts`. Returns `{ formated, promptText? }`; coordinator attaches `promptInfo.promptText` conditionally. The `parseChatML`, `prebuiltAssetCommand`, `runLuaEditTrigger`, and `systemizeChat` imports moved out of the coordinator. | F4-A, F4-B, F4-F (all landed)                                                                                                                     |
| 5-24 Dispatch request               | done 2026-05-22 | Extracted the stage-3 transition (with `setProcessStage` callback + `stageTimings.stage3Start`), the `arg.preview` early return, `generationId` + `generationModel` + `generationInfo` construction, the `requestChatData(...)` call with the full payload, the `req.model` override into `generationInfo.model`, the `arg.previewPrompt + req.type === 'success'` previewPrompt early return, the post-provider `abortSignal.aborted` check, and the `req.type === 'fail'` early return into `src/ts/process/dispatch/dispatchRequest.ts`. Returns a 5-variant discriminated union (`preview` / `previewPrompt` / `aborted` / `failed` / `success`); the coordinator owns the `previewFormated` / `previewBody` writes, the `throwError(reason)` on failure, and `generationInfo` attachment for both success and failed paths. The `v4` (uuid), `getGenerationModelString`, and `requestChatData` imports moved out of the coordinator (uuid stays for the `chatId` backfill at line 205). Two pre-existing `console.log` debug calls dropped during the move. | F4-G (landed)                                                                                                                                     |
| 5-25 Response orchestration         | open            | Extract the stream/non-stream branch chooser plus shared output-trigger, inlay-screen, TTS, auto-continue, and IGP orchestration. Existing response helpers stay in `postGeneration/`.                                                                                                                                                                                                                                                                                                                                                                                           | Existing fixtures; add unit tests only if the orchestration helper gets a narrow signature.                                                       |
| 5-26 Stage-4 orchestrator           | open            | Extract resend handoff, notification, provider emotion, emotion fallback routing, image-generation dispatch, and final `finalizeStage4` call into one stage-4 wrapper.                                                                                                                                                                                                                                                                                                                                                                                                           | Existing fixtures cover notification/emotion/imggen helpers indirectly only; add a fixture if wrapper behavior changes.                           |
| 5-27 Entry context                  | open            | Extract preset-chain selection, stat counter, selected character/chat lookup, chatId backfill, prompt-info seed, tokenizer creation, and current-chat parser pass. This comes late because many earlier slices currently close over these values.                                                                                                                                                                                                                                                                                                                                | Existing fixtures plus a focused prompt-info seed unit test.                                                                                      |
| 5-28 Coordinator closeout           | open            | Inline cleanup after the preceding slices: remove dead locals, make stage handoffs explicit, verify `index.svelte.ts` is under 500 lines, and update status docs.                                                                                                                                                                                                                                                                                                                                                                                                                | All gates satisfied                                                                                                                               |

## Acceptance Per Slice

For a fixture gate:

```bash
UPDATE_FIXTURES=1 pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts
```

For every Phase 5 extraction slice:

```bash
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts
```

Also run any targeted helper tests touched by the slice. Before
closing Phase 5, run:

```bash
pnpm check
pnpm test
pnpm build
```

Tauri build remains a manual phase-boundary verification.
