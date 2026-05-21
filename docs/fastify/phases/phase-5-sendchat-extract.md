# Phase 5 - sendChat Extraction

Date: 2026-05-21

## Goal

Carve `sendChat` into stage-shaped modules behind the Phase 4
fixtures. The function becomes a coordinator that wires stages
together; the work moves into files that can be ported to the
server one at a time in later phases.

## Preconditions

- Phase 0 closed (no dead branches).
- Phase 4 closed (fixtures pin behavior).

## Status

In progress as of 2026-05-21. Phase 5-1 through Phase 5-21 have
landed. The current coordinator is
`src/ts/process/index.svelte.ts` (1017 lines), with extracted
helpers in `src/ts/process/autoContinue.ts`,
`src/ts/process/sendChatErrors.ts`,
`src/ts/process/postGeneration/*`,
`src/ts/process/promptBudget/*`, and
`src/ts/process/promptAssembly/*`.

## Scope

### Current extracted shape

```
src/ts/process/
  index.svelte.ts             coordinator, still being reduced
  autoContinue.ts             auto-continue decision
  sendChatErrors.ts           inlay-error / alert reporting
  postGeneration/
    notification.ts           desktop notification
    igp.ts                    IGP dispatch
    stage4Finalize.ts         generationInfo timing writeback
    charEmotionStore.ts       shared emotion-store helpers
    emotionFromResponse.ts    provider-returned emotion
    emotionFallbackLlm.ts     LLM emotion fallback
    emotionFallbackEmbedding.ts
                              embedding emotion fallback
    imggenStableDiff.ts       imggen stable-diff handoff
    outputTrigger.ts          post-response output trigger
    nonStreamResponse.ts      success / multiline response loop
    streamResponse.ts         streaming reader loop
  promptBudget/
    finalizeRequestBudget.ts  post-editRequest token recheck +
                              outputTokens estimate
    preflightTemplateTokens.ts first prompt-template token walker +
                              memory/cache flag discovery
  promptAssembly/
    buildDescription.ts       leading character-description
                              system message
    buildPlainPromptSections.ts
                              non-template main / jailbreak /
                              globalNote sections (@@role-aware)
    normalizeTemplate.ts      prompt-template clone, implicit
                              postEverything, utility-bot override
    buildStaticPromptSections.ts
                              author note, cot, persona,
                              inlay-view instructions
    buildLorebookContext.ts   lorebook placement, position slots,
                              depth-prompt filter
    systemizeChat.ts          role-to-system conversion for chat
                              cards
    formatHistoryMessage.ts   one Message -> one OpenAIChat
    buildHistoryWindow.ts     examples, marker, first message,
                              triggers, history loop, depth prompts
```

Remaining extraction should keep moving toward a coordinator whose
major responsibilities are validation / setup, prompt assembly,
dispatch, and finalization orchestration. The Svelte stores stay
where they are (the function is still browser-only at this phase).
If a later slice introduces a `pipeline/` directory, it should absorb
or call the helpers above rather than duplicating them.

The remaining work is divided in
[`../status/sendchat-slicing.md`](../status/sendchat-slicing.md).
That shard is the work picker for Phase 5-22 onward: it maps the
current inline blocks to target modules and names the fixture gates
that should land before risky prompt-template, lorebook, history,
memory, or dispatch extraction.

### Migration recipe

For each stage:

1. Identify the entry and exit points in the current coordinator
   (use the `stageTimings.*Start` markers listed
   in [`../status/sendchat.md`](../status/sendchat.md)).
2. Lift the block into the new module with the minimum signature
   that compiles.
3. Run
   `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts`.
   Diff failures by hand; adjust the new module until the fixture
   set is green again.
4. Land the slice as one commit per seam. Bisect-friendly.

Hidden coupling discovered during extraction (Svelte stores read
mid-function, globals mutated, side effects with no return value)
goes into the module's signature where the seam is stable. Some
Phase 5-1 through 5-21 helpers still read or mutate `DBState`
directly where the browser-only boundary is not stable yet; later
slices should either make those writes explicit in the helper
contract or leave a clear browser-only boundary for Phase 6 to
route around.

### What does not move yet

- Lorebook keyword activation still uses the browser's
  `loadLoreBookV3Prompt`. Phase 7 ports it to the server.
- Hypa V3 still uses the browser's `hypav3` module. Phase 8 ports
  it.
- Tokenizers still use the browser's `src/ts/tokenizer.ts` stack
  (`@dqbd/tiktoken`, `@mlc-ai/web-tokenizers`, and
  provider-specific tokenizer assets). Phase 6 ports tokenizer
  counting; Phase 7 reuses the port for prompt budget.
- Triggers still run in the browser sandbox. Phase 6 introduces a
  server-side `node:worker_threads` sandbox; the browser path
  stays as a fallback until Phase 9.

## Boundaries

- **Do not move any stage server-side in this phase.** That is
  Phases 6-9. Phase 5's job is _only_ to make the seams visible.
- **Do not change observable behavior.** Every fixture must stay
  green at the end. New fixtures get added if extraction reveals a
  behavior the original set did not cover.
- **Do not split a stage into "good" and "legacy" branches.** If a
  branch is dead, delete it. If it is alive, keep it together.
- **Do not introduce new abstractions.** Modules are flat files
  with named exports. No classes, no DI containers, no event bus.
  The coordinator is the wiring.

## Exit criteria

- `src/ts/process/index.svelte.ts` is under 500 lines and contains
  only coordinator logic.
- Each extracted module is independently testable (the fixtures may
  exercise it through the coordinator; targeted unit tests per module
  are encouraged and already exist for the Phase 5-3 through
  Phase 5-21 helpers).
- `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts`
  is green.
- `pnpm check`, `pnpm test`, `pnpm build` green.
- The fixture set has grown to include any behaviors discovered
  during extraction; the new entries are listed in
  [`../coverage/sendchat-fixtures.md`](../coverage/sendchat-fixtures.md).

## Reference

- `risuai-metatron/server-py/app/services/chat_generation/`
  shows one viable end-state split:
  `generation_validation`, `message_state`, `prompt_builder`,
  `prompt_sections`, `prompt_history`, `prompt_templates`,
  `prompt_budget`, `lorebook`, `tokenizer`, `providers`,
  `generation_lifecycle`, `postprocess`. The TypeScript pipeline
  targets a similar shape, scaled down to what the current code
  actually does.
