# Phase 5 - sendChat Extraction

Date: 2026-05-20

## Goal

Carve `sendChat` into stage-shaped modules behind the Phase 4
fixtures. The function becomes a coordinator that wires stages
together; the work moves into files that can be ported to the
server one at a time in later phases.

## Preconditions

- Phase 0 closed (no dead branches).
- Phase 4 closed (fixtures pin behavior).

## Scope

### Target shape

```
src/ts/process/
  index.svelte.ts             coordinator (~300 lines)
  pipeline/
    validate.ts               Stage 1: chat lookup, mode check,
                              user-row prep, regenerate truncation
    prompt/
      assemble.ts             Stage 2: walk promptTemplate
      lorebook.ts             activation + recursion
      history.ts              chat history shaping
      tokens.ts               budget pruning
      memory.ts               Hypa V3 wrapper
    dispatch.ts               Stage 3: provider request + stream
    finalize.ts               Stage 4: post-text, emotion, auto-
                              continue, reroll metadata
    sideEffects.ts            TTS, inlay screen, stable diff queue
```

`process/index.svelte.ts::sendChat` calls each stage in order, threads
the abort signal through, and emits the same observable surface the
fixtures pin. The Svelte stores stay where they are (the function is
still browser-only at this phase).

### Migration recipe

For each stage:

1. Identify the entry and exit points in the current 2090-line
   function (use the `stageTimings.*Start` markers).
2. Lift the block into the new module with the minimum signature
   that compiles.
3. Run `pnpm test -- sendChat.fixtures`. Diff failures by hand;
   adjust the new module until the fixture set is green again.
4. Land the slice as one commit per stage. Bisect-friendly.

Hidden coupling discovered during extraction (Svelte stores read
mid-function, globals mutated, side effects with no return value)
goes into the module's signature. A stage that needs `DBState` to
write a message row passes the write back to the coordinator
instead of mutating the store directly. This is what lets Phase 6
move dispatch server-side without ripping out coupling first.

### What does not move yet

- Lorebook keyword activation still uses the browser's
  `loadLoreBookV3Prompt`. Phase 7 ports it to the server.
- Hypa V3 still uses the browser's `hypav3` module. Phase 8 ports
  it.
- Tokenizers still use `@dqbd/tiktoken` in the browser. Phase 6
  ports tokenizer counting; Phase 7 reuses the port for prompt
  budget.
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
- Each `pipeline/` module is independently testable (the fixtures
  may exercise it through the coordinator; targeted unit tests
  per module are encouraged but not required).
- `pnpm test -- sendChat.fixtures` is green.
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
