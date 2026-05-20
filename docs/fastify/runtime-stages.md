# Runtime Stages

Date: 2026-05-20

This doc describes the stages a `sendChat` invocation moves through
and who owns each stage **after the migration**. Before migration
they all live in the browser. The phases in [`phases/`](phases/)
move each stage to its target owner.

The stage names match the existing `stage1`-`stage4` timing markers
in `src/ts/process/index.svelte.ts` so a reader can trace from the
current code to the future shape.

## Stage 0 - UI lease and dispatch

Owner (after migration): browser.

- Acquires the `doingChat` lease so two chat screens can't dispatch
  at once.
- Sets `chatProcessStage` for the spinner.
- Forwards the caller's `AbortSignal` to the server via `fetch`'s
  signal.
- Collects inlay assets the user just dropped (browser-only blobs)
  and ships them as part of the request body.
- Receives SSE events and applies them to the rendered chat.
- Releases the lease on `done` / `error` / abort.

## Stage 1 - Validate and message sync

Owner (after migration): server.

- Reads the chat + character row by id.
- Validates the requested mode (`send` / `continue` / `preview` /
  `preview_prompt` / `regenerate`).
- Checks the `expected_revision` cursor; rejects stale requests with
  `409` + the current revision.
- Reset, regenerate truncation, route-created user rows, and
  default say-nothing behavior all run here.
- Persists the user row (for non-preview, non-reset modes) before
  prompt assembly begins.

The current `sendChat` does this work in browser code between
function entry and line ~330 (`stageTimings.stage1Start`).

## Stage 2 - Prompt assembly

Owner (after migration): server.

- Walks the preset's `promptTemplate` in order; substitutes
  `{{user}}` / `{{char}}` / variables; resolves persona, description,
  author note, example messages, scenario, jailbreak.
- Activates lorebook entries (constant + keyword + recursion budget).
- Pulls Hypa V3 memory summaries for the budget window.
- Computes the final OpenAI-shaped `messages[]` payload.
- Runs `editRequest` triggers in the server-side trigger sandbox.

The current `sendChat` does this work between
`stageTimings.stage1Start` and `stageTimings.stage2Duration` (~lines
330-1190).

## Stage 3 - Provider dispatch and streaming

Owner (after migration): server.

- Resolves the provider config (model id, base URL, key).
- Issues the upstream request with the proxy's URL/method/header
  sanitizers.
- Forwards SSE chunks to the client; emits `token` / `message_patch`
  / `info` / `warning` frames.
- Aborts the upstream on client disconnect.
- Persists the assistant row incrementally and on completion.
- On provider error, runs the cleanup / restoration patches and
  emits `error`.

The current `sendChat` does this work between
`stageTimings.stage3Start` (~line 1654) and
`stageTimings.stage3Duration` (~line 1930).

## Stage 4 - Finalize and post-generation

Owner (after migration): mostly server, a few effects stay browser.

Server owns:

- `removeIncompleteResponse` final-text trimming.
- Bounded auto-continue.
- Emotion marker rewriting / submodel emotion selection.
- Bounded reroll metadata (number of accumulated alternates).
- `editOutput` triggers in the server-side trigger sandbox.

Browser still owns:

- TTS playback (`sayTTS`).
- Image generation preview / inlay screen rendering
  (`runInlayScreen`, `stableDiff` user-facing display).
- Browser image embedding for `runImageEmbedding`.

The split exists because TTS and image preview are speaker /
display side effects that require the user's tab to be the active
output. Server still does the heavy lifting where it can (image
generation provider call, text-to-speech provider call), but the
browser owns playback / rendering.

The current `sendChat` does this work after
`stageTimings.stage4Start` (~line 1936) through the end of the
function.

## How the stages map to phases

- Phase 4 (`phases/phase-4-sendchat-tests.md`) pins observable
  behavior of Stages 0-4 with fixtures while everything still runs
  in the browser.
- Phase 5 (`phases/phase-5-sendchat-extract.md`) carves each stage
  into a browser module without moving any of them server-side.
  This is the "make the seam visible" step.
- Phase 6 (`phases/phase-6-server-generation.md`) moves Stage 3
  (provider dispatch) server-side.
- Phase 7 (`phases/phase-7-prompt-assembly.md`) moves Stage 2
  (prompt assembly) server-side.
- Phase 8 (`phases/phase-8-memory.md`) makes Hypa V3 memory a
  server-side resource that Stage 2 reads from.
- Phase 9 (`phases/phase-9-client-thinning.md`) moves Stage 1
  (validate + persist) server-side and reduces Stage 0 to a thin
  bridge.

Stage 4's browser-owned effects stay where they are; the server
emits side-effect frames that the browser dispatches.

## Reference notes

- `risuai-metatron/docs/send-chat-migration/runtime-stages.md`
  uses a similar A-E split (Frontend Guard, Server Validate,
  Server Prompt + Plan, Server Persist + Execute, Post-Generation).
  The stage numbering here matches the **existing client timing
  markers** to keep the mapping back to current code obvious.
