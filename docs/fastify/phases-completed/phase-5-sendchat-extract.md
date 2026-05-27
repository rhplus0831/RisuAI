# Phase 5 - sendChat Extraction

Date: 2026-05-22

## Goal

Carve `sendChat` into stage-shaped modules behind the Phase 4
fixtures. The function becomes a coordinator that wires stages
together; the work moves into files that can be ported to the
server one at a time in later phases.

## Preconditions

- Phase 0 closed (no dead branches).
- Phase 4 closed (fixtures pin behavior).

## Status

Closed 2026-05-22. All 28 slices landed, ending with coordinator
closeout commit `a7e2831d`. At that closeout, the coordinator was
`src/ts/process/index.svelte.ts` (445 lines), with extracted
helpers in `src/ts/process/autoContinue.ts`,
`src/ts/process/sendChatContext.ts`,
`src/ts/process/sendChatErrors.ts`,
`src/ts/process/dispatch/*`, `src/ts/process/postGeneration/*`,
`src/ts/process/promptBudget/*`, and
`src/ts/process/promptAssembly/*`.

## Scope

### Current extracted shape

```
src/ts/process/
  index.svelte.ts             coordinator / lifecycle wiring
  autoContinue.ts             auto-continue decision
  sendChatContext.ts          entry-context setup
  sendChatErrors.ts           inlay-error / alert reporting
  dispatch/
    dispatchRequest.ts        provider dispatch + preview exits
  postGeneration/
    notification.ts           browser notification
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
    orchestrateResponse.ts    response branch chooser +
                              auto-continue / IGP handoff
    runStage4.ts              stage-4 closeout orchestration
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
    buildMemoryWindow.ts      Hypa V3 / fallback budget window +
                              memory-card split
    renderFinalPrompt.ts      final template / formatting render
```

The coordinator now owns lifecycle wiring, browser-only closures,
depth-prompt distribution, trigger-result placement, and recursive
handoffs. The Svelte stores stay where they are because Phase 5 is
browser-only. The closed slice record lives in
[`phase-5-sendchat-slicing.md`](phase-5-sendchat-slicing.md).

### Historical migration recipe

During Phase 5, each stage followed this recipe:

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
went into helper signatures where the seam was stable. Helpers that
still read or mutate `DBState` directly document a browser-only
boundary that Phase 6 and later phases must route around or make
explicit.

### What does not move yet

- Lorebook keyword activation still uses the browser's
  `loadLoreBookV3Prompt`. Phase 7 ports it to the server.
- Hypa V3 still uses the browser's `hypav3` module. Phase 8 ports
  it.
- Tokenizers still use the browser's `src/ts/tokenizer.ts` stack
  (`@dqbd/tiktoken`, `@mlc-ai/web-tokenizers`, and
  provider-specific tokenizer assets). Phase 7 has since landed a
  minimal server tokenizer for prompt-budget heuristics; exact
  provider tokenizers and public count-token routes remain
  fixture-driven follow-ups.
- Triggers still run in the browser sandbox for browser-only plugin /
  Lua hooks. Phase 7 has since landed the deterministic server-safe
  runner needed by prompt assembly; the worker-style trigger helper
  route from the original Phase 6 target remains deferred.

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

- Met at closeout: `src/ts/process/index.svelte.ts` is under 500
  lines and contains only coordinator logic.
- Met at closeout: each extracted module with a stable signature has
  targeted tests, and the fixture harness exercises the rest through
  the coordinator.
- Met at closeout: `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts`,
  `pnpm check`, `pnpm test`, and `pnpm build` were green.
- Met at closeout: the fixture set grew to cover behaviors discovered
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
