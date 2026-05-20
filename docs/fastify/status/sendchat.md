# sendChat Status

Date: 2026-05-20

## Current state

`src/ts/process/index.svelte.ts::sendChat` is a single 2090-line
async function with these visible markers:

- `stage1Start` at line 273 - validation, lorebook prep, persona,
  description assembly.
- `stage2Start` at line 1013 - Hypa V3 memory retrieval and prompt
  memory-card accounting. The current timing marker is narrower
  than the future Stage 2 module; the surrounding prompt assembly is
  still browser code.
- `stage3Start` at line 1501 - provider dispatch via
  `requestChatData()`; inlay screen + TTS run after the first
  response chunk.
- `stage4Start` at line 1783 - post-generation (auto-continue,
  emotion, stable diff, reroll metadata).

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

No `sendChat` characterization tests exist. Existing `process/`
tests cover helper surfaces only: TTS hooks, request additional
params, MCP Risu access modules, and inlay asset helpers.

## What lands when

- **Phase 4.** Fixture-driven characterization tests that pin the
  observable behavior of the current function. Inputs: canned
  database snapshots, canned chat state, canned upstream provider
  responses (fakes). Outputs: the message patches the function
  emits and the persisted chat shape.
- **Phase 5.** Per-stage extraction behind the fixtures. The
  function becomes a coordinator that calls into
  `process/{validate, prompt, dispatch, finalize}.ts` (or similar
  names; finalized in Phase 5).
- **Phase 6.** Stage 3 dispatch moves server-side. Browser keeps
  a thin client that reads the server's SSE stream.
- **Phase 7.** Stage 2 prompt assembly moves server-side.
- **Phase 9.** Stages 1 + 4 move server-side; Stage 0 becomes a
  ~50-line bridge that owns the UI lease, abort forwarding, and
  side-effect dispatch.

## Boundary rules

Until Phase 5 closes, avoid editing `sendChat` itself unless a
targeted bug fix is required. The function is the target, not the
source of work. Refactoring control flow belongs behind Phase 4
fixtures and Phase 5 extraction.

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
