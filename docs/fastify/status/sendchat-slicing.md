# sendChat Remaining Slice Plan

Date: 2026-05-21

This shard is the work picker for the rest of Phase 5. Phase 4 is
still closed: the 17 landed fixtures remain the baseline safety net.
The "Phase 4 gates" below are targeted fixture additions to land
immediately before a Phase 5 slice touches an uncovered behavior.

The intent is to keep agents from choosing only tiny helpers while
also avoiding one oversized "finish sendChat" task. Pick the first
open slice below; if its fixture gate is not satisfied, land that
gate first, then land the extraction slice. Update this file and
[`next-steps.md`](next-steps.md), then move on.

## Current Code Map

`src/ts/process/index.svelte.ts` is 1241 lines. Phase 5-1 through
5-19 already extracted auto-continue, owned `doingChat` lifecycle,
error reporting, response loops, most post-generation helpers, final
request-budget recheck, character description, plain-prompt main /
jailbreak / global-note sections, prompt-template normalization
(clone + implicit `postEverything` + utility-bot override), the
static prompt sections (author note, chain-of-thought, persona,
inlay-view), the lorebook placement context (`{{position::...}}`,
injection lore, normal / description / postEverything placements;
returns `resolvePosition`, `positionParser`, and `depthPrompts`),
and the template token preflight (per-card token math plus the
`memoryCardUsed` / `hasCachePoint` flag discovery, plus the no-
template path that tokenizes every `unformated` slot).

The work still inside the coordinator is clustered here:

| Lines     | Remaining responsibility                                                                                                                          | Target owner after Phase 5           |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 91-265    | Entry guard, preset-chain switch, selected character/chat setup, prompt-info seed, tokenizer setup.                                               | `sendChatContext` / lifecycle helper |
| 317-551   | Example messages, first message, start trigger, history message formatting, inlays, asset prompts, thought extraction, initial token budget.     | history assembly helper              |
| 552-643   | Hypa V3 handoff, fallback budget trimming, memory-card split / previous-conversation wrapping.                                                    | memory-window helper                 |
| 667-981   | Final prompt rendering, `pushPrompts`, template rendering, cache points, prompt-info text capture, character depth prompt, `editRequest` trigger. | prompt render helper                 |
| 997-1073  | Generation metadata, preview exits, provider request payload, fail / abort exits.                                                                 | dispatch helper                      |
| 1074-1175 | Stream vs non-stream orchestration, output-trigger result, inlay / TTS side effects, auto-continue and IGP.                                       | response orchestration helper        |
| 1180-1231 | Resend handoff, notifications, emotion fallback routing, image generation dispatch, final timing writeback.                                       | stage-4 orchestrator                 |

## Phase 4 Fixture Gates

Do not reopen Phase 4 as a broad task. Add one fixture only when the
next extraction slice would otherwise move behavior that snapshots do
not cover.

| Gate                                | Add before                                 | Fixture behavior to pin                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F4-A `prompt-template-basic`        | Template normalization or render slices.   | Landed 2026-05-21. Template with `persona`, `description`, `authornote`, `plain`, `chatML`, `chat`, no explicit `postEverything`. `chainOfThought: true` so the implicit `postEverything` insertion is observable as the trailing cot system message in `formated`. |
| F4-B `prompt-template-memory-cache` | Memory-window or template cache slices.    | Landed 2026-05-21. Template with `memory` (innerFormat: `"Memory: {{slot}}"`) and `cache` (depth: 2, role: 'user') cards, Hypa V3 mock memory, and `automaticCachePoint: true`. Pins that the memory card wraps the canned summary as a system entry with `memo: 'hypaMemory'`, the cache card marks msg-user-3 and msg-user-4 with `cachePoint: true`, and the automatic walk-back is suppressed (msg-user-2 stays unmarked). |
| F4-C `lorebook-position-depth`      | Lorebook placement slices.                 | Landed 2026-05-21. Six globalLore entries exercising `@@position before_desc`, `@@position after_desc`, `@@depth 1`, `@@reverse_depth 1`, `@@position pt_<name>`, and a `{{position::<name>}}` reference; snapshot pins the leading-system-block ordering, the chat-history splice positions, and end-to-end `resolvePosition`. |
| F4-D `history-media-fallback`       | History formatting slices.                 | Inlay image on a model without image input, mocked `runImageEmbedding`, plus `{{asset_prompt::icon}}`; assert caption append and multimodal asset attachment.                 |
| F4-E `start-trigger-control`        | Start-trigger / history collection slices. | Mock `runTrigger('start')` to mutate chat and add token cost; include a stop-sending variant if the slice touches that early return.                                          |
| F4-F `prompt-info-text`             | Prompt-info or template-render slices.     | Enable `promptInfoInsideChat` + `promptTextInfoInsideChat`; assert `generationInfo.promptInfo.promptText` after `editRequest`.                                                |
| F4-G `preview-prompt`               | Dispatch slices.                           | Call `sendChat(..., { previewPrompt: true })`, fake a success response, and assert `previewBody` with no persisted assistant message.                                         |
| F4-H `utility-bot-template`         | Template normalization slices.             | Landed 2026-05-21. `utilityBot: true` with no `promptTemplate` and default `utilOverride: false`. Pins that the forced 6-card template replaces the default `mainPrompt` / `globalNote`, so `formated` shrinks to description + history only. |

## Phase 5 Remaining Slices

Keep each slice large enough to retire a real responsibility from
`index.svelte.ts`, but small enough to review as one commit. Targeted
unit tests are expected when the extracted helper has a stable public
signature; otherwise the fixture gate plus the full sendChat fixture
suite is the acceptance test.

| Slice                               | Status | Scope                                                                                                                                                                                                                                             | Fixture gate                                                                                                            |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 5-16 Template normalization         | done 2026-05-21 | Extracted prompt-template cloning, implicit `postEverything`, and utility-bot override into `src/ts/process/promptAssembly/normalizeTemplate.ts`. The coordinator call site at `index.svelte.ts:274` destructures `{ promptTemplate, usingPromptTemplate }`. No rendering moved. | F4-A, F4-H (both landed)                                                                                                |
| 5-17 Author/persona/static sections | done 2026-05-21 | Extracted author note (with template default fallback), chain-of-thought instruction, persona prompt, and inlay-view `postEverything` instructions into `src/ts/process/promptAssembly/buildStaticPromptSections.ts` as four pure functions returning `OpenAIChat[]`. The coordinator now stages each push at the correct point in the `unformated` assembly. | Existing fixtures cover author note and persona; `buildStaticPromptSections.test.ts` adds 16 focused cases for cot gates and inlay-view branches. |
| 5-18 Lorebook placement context     | done 2026-05-21 | Extracted `loadLoreBookV3Prompt()` plus the `resolvePosition` / `positionParser` closures, normal / description / postEverything lore placements, and the depth-prompt filter into `src/ts/process/promptAssembly/buildLorebookContext.ts`. Helper mutates the three relevant `unformated` slots and returns `{ resolvePosition, positionParser, depthPrompts }` for the downstream walkers and the two depth-prompt loops (token preflight + history splice). Two leftover `console.log` calls dropped. | F4-C (landed)                                                                                                           |
| 5-19 Template token preflight       | done 2026-05-21 | Extracted the first prompt-template walker into `src/ts/process/promptBudget/preflightTemplateTokens.ts`. Returns `{ addedTokens, memoryCardUsed, hasCachePoint }`. Handles both the templated and no-template paths. The local `systemizeChat` helper was moved to `src/ts/process/promptAssembly/systemizeChat.ts` so both the preflight helper and the still-inline final render walker can import it from one place. | F4-A, F4-B (both landed)                                                                                                |
| 5-20 History message formatter      | open   | Extract one-message conversion from `Message` to `OpenAIChat`: editprocess scripts, name handling, inlay stripping, multimodal attachments, image-caption fallback, thought extraction, and asset prompts.                                        | F4-D                                                                                                                    |
| 5-21 History assembly window        | open   | Extract examples, `[Start a new chat]`, first message, disabled / allBefore filtering, start trigger handling, token accounting, and initial context trimming. Call the 5-20 formatter.                                                           | F4-E                                                                                                                    |
| 5-22 Memory window                  | open   | Extract Hypa V3 stage transition, error writeback, fallback budget trim, `lastMemory`, memory-card split, and `<Previous Conversation>` wrapping.                                                                                                 | F4-B                                                                                                                    |
| 5-23 Final prompt render            | open   | Extract `pushPrompts`, non-template `formatingOrder`, template render walker, cache-point mutation, prompt-info text capture, character depth prompt, and `editRequest` trigger.                                                                  | F4-A, F4-B, F4-F                                                                                                        |
| 5-24 Dispatch request               | open   | Extract generation metadata creation, preview / previewPrompt exits, `requestChatData` argument construction, model override update, abort check, and provider-fail handling.                                                                     | F4-G                                                                                                                    |
| 5-25 Response orchestration         | open   | Extract the stream/non-stream branch chooser plus shared output-trigger, inlay-screen, TTS, auto-continue, and IGP orchestration. Existing response helpers stay in `postGeneration/`.                                                            | Existing fixtures; add unit tests only if the orchestration helper gets a narrow signature.                             |
| 5-26 Stage-4 orchestrator           | open   | Extract resend handoff, notification, provider emotion, emotion fallback routing, image-generation dispatch, and final `finalizeStage4` call into one stage-4 wrapper.                                                                            | Existing fixtures cover notification/emotion/imggen helpers indirectly only; add a fixture if wrapper behavior changes. |
| 5-27 Entry context                  | open   | Extract preset-chain selection, stat counter, selected character/chat lookup, chatId backfill, prompt-info seed, tokenizer creation, and current-chat parser pass. This comes late because many earlier slices currently close over these values. | Existing fixtures plus a focused prompt-info seed unit test.                                                            |
| 5-28 Coordinator closeout           | open   | Inline cleanup after the preceding slices: remove dead locals, make stage handoffs explicit, verify `index.svelte.ts` is under 500 lines, and update status docs.                                                                                 | All gates satisfied                                                                                                     |

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
