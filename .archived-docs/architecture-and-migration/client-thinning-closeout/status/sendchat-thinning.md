# Chat-Process Ownership (sendChat)

Date: 2026-05-30

The detailed blocker triage for "the server owns the chat process." Read this for
any batch touching chat submission, prompt assembly, server chat SSE, provider
routing, generation persistence, or post-generation branches.

## Dividing Line

The server must own anything that **decides or derives durable state**: the
assembled prompt, the LLM call, and post-generation message/scriptstate mutations.
The browser may keep anything where it only **triggers, plays, orchestrates, or
requests a write** — it never becomes the authority.

## Pipeline Owners (current)

`DefaultChatScreen.svelte::sendMain` → `src/ts/process/index.svelte.ts::sendChat`
→ assembly → dispatch → `postGeneration/orchestrateResponse.ts` →
`postGeneration/runStage4.ts` → persist.

| Stage                  | Default owner                                                                                                                                                                                                                                                             | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-send input         | Browser                                                                                                                                                                                                                                                                   | UID/input plumbing; rows persist via commands (B1).                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Prompt assembly        | **Server-mandatory for the text-send subset + multimodal/asset on vision models + non-interactive Lua edit/input hooks + image-gen instruction** (`resolveServerPromptAssembly`); Browser (`assembleLocalSendChatPrompt`) only when `!isFastifyServer` or the flag is off | Slice 1 landed the classifier; slice 3a graduated multimodal/asset; slice 3b graduated Lua `editRequest`, `editprocess`, input-trigger, and `editinput`; slice 3c graduated the image-gen instruction. Remaining `unsupported`: non-vision caption (class 2), interactive Lua dialogs, and permanent pluginV2.                                                                                                                                                        |
| Provider dispatch      | **Server** (`/generate/chat` in the default Fastify flow; `/generate/completion` only for non-Fastify or explicit local-assembly opt-out)                                                                                                                                 | `resolveServerCompletionRoute` gates the completion path; `/generate/chat` uses `server/fastify/src/prompt/chatDispatch.ts`; both consume `resolveProviderCapability`. `local` only if `!isFastifyServer`; unsupported → hard fail (**A3**).                                                                                                                                                                                                                          |
| Token streaming → rows | Browser                                                                                                                                                                                                                                                                   | Writes the projection.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Post-generation        | **Server (durable) + Browser (effects)**                                                                                                                                                                                                                                  | Durable derivation — `editoutput`, run-var pass, `'output'` trigger — is **server-owned (A2 done, slice 4)** when derivation succeeds: `runServerPostGeneration` derives + persists the scriptstate delta and ships the final text on `done.postGeneration`. If derivation throws, `/generate/chat` omits that frame and the browser does not run a local derivation fallback on this path. Browser keeps inlay-screen render (B1), auto-continue/IGP recursion (B2). |
| Stage-4 closeout       | **Browser**                                                                                                                                                                                                                                                               | Notification, emotion, image-gen, TTS, stage metadata (B1/B2).                                                                                                                                                                                                                                                                                                                                                                                                        |
| HypaV3 memory          | **Server**                                                                                                                                                                                                                                                                | Persistence + jobs server-side; progress UI is browser (B1).                                                                                                                                                                                                                                                                                                                                                                                                          |
| Durable persistence    | **Mixed**                                                                                                                                                                                                                                                                 | Assembly-time scriptstate delta is now persisted by `/generate/chat` itself (**C-A1, done**); final-message persistence is still command-backed (B2).                                                                                                                                                                                                                                                                                                                 |

## A. Hard Blockers

### A1 — Prompt-assembly content parity

The server `/generate/chat` assembler (`server/fastify/src/prompt/`) is at parity
for run-vars, CBS/variable expansion, regex scripts, templates, token budget,
lorebook + depth prompts, start triggers, HypaV3 selection, **multimodal /
asset inlining (slice 3a)**, and the **image-gen instruction (slice 3c)**. Current
content rows:

- **Multimodal / asset inlining** — **DONE (slice 3a).** `beginAssembly` binds a
  non-empty `AssetLookup` (`prompt/assetLookup.ts`): inlay bytes from the request
  `inlayAssets` (now populated by `serverBackedSendChat.ts`), asset/icon bytes
  from the store (`resolveStoredAssetImage`). Vision models → `server`.
- **Non-vision image-caption fallback** — browser-only (`runImageEmbedding`);
  routes `unsupported` (slice 3a class 2). No server path.
- **Image-gen instruction** (`buildInlayViewInstruction` / `newGenData`) — **DONE
  (slice 3c).** `fillStaticSlots` appends the same static `newGenData` /
  `viewScreen` `system` row to `postEverything` (incl. `{{slot}}` → `emotionImages`
  substitution). Routes `server`. The post-gen image generation / inlay rendering
  stays a browser effect (B1).
- **Lua `editRequest`, `editprocess`, input-trigger, and `editinput`** — **DONE
  (slice 3b).** Non-interactive `triggerlua` routes `server`; interactive dialog
  APIs (`alertInput`/`alertSelect`/`alertConfirm`) route `unsupported`.
- **pluginV2 edit/replacer hooks** — permanent unsupported, not a port target.

These are _correctness_ differences in the assembled prompt. Assembly is
all-or-nothing per send, so they cannot silently stay browser-side. Resolution:
port the class, or classify the send as server-unsupported — never a silent
fallback.

**Foundation primitive (landed, slice 1):** `resolveServerPromptAssembly`
(`src/ts/process/request/serverPromptAssembly.ts`) mirrors
`resolveServerCompletionRoute` and returns `local | server | unsupported`. It
replaced the boolean gate at `index.svelte.ts`: in Fastify mode with
`useServerPromptAssembly` on by default, the supported subset routes `server` (local
assembler unreachable for it), and each unported/unsupported class (interactive
Lua, pluginV2, non-vision caption), a non-user-message send, a group
character, and a non-server-routable provider route `unsupported` and hard-fail. The soft
`unavailable` escape (the silent non-string-`send` → local fall-through) is
deleted. `local` is reached only when `!isFastifyServer` or the flag is off.

**A1 content graduation — complete:** each content slice ports one class to the
server assembler and flips its detector in the classifier from `→ unsupported` to
`→ server`. **Slices 3a, 3b, and 3c are done** (multimodal/asset → `server` for
image-input models; Lua edit/input hooks → `server` except interactive dialogs;
image-gen instruction → `server`). Non-vision caption stays `unsupported` (no
server caption pipeline). Each detector is isolated behind its own named
predicate. The classifier still reads `useServerPromptAssembly` as an explicit
opt-out/test gate; removing the flag entirely would be a separate closeout, not a
content-parity task.

### A2 — Post-generation durable derivation — DONE (slice 4)

`runServerPostGeneration` (`assemble.ts`) runs the post-generation pass after
dispatch, reusing the assembler state + the Lua/trigger machinery A1 landed:

- **`editoutput`** — Lua `editOutput` → CBS → regex `editoutput` over the
  completion text; the derived final text rides the terminal `done.postGeneration`,
  and the browser writes it onto the assistant message (B2 persists it).
- **Pre-trigger run-var pass + `'output'` trigger** — `runTrigger(char, 'output', …)`
  - the run-var pass derive the durable `chat.scriptstate` delta, which the route
    persists through the slice-2 writer (`persistAssemblyMutations`, one revision
    bump) and surfaces as a post-gen `message_patch`. Resend (`sendAIprompt`) is
    reported on `done`; the resend recursion stays browser-side (B2).

The browser's durable derivation is removed on the server-owned path
(`orchestrateResponse` `serverOwnsPostGeneration` skips `applyOutputTrigger` +
`editoutput`; `applyServerBackedTerminal` consumes the patch + final text + resend).
Output-trigger message surgery is surfaced to the projection. Proven by the A2
cases in `generation.chat.test.ts`, the output-trigger / editoutput cases in
`sendChat.fixtures.serverBacked.test.ts`, and the flip in `orchestrateResponse.test.ts`.

Current caveat: `generationChat.ts::buildPostGenerationFrame` catches
`runServerPostGeneration` failures and returns no post-generation frame. Because
the browser has already skipped the local `editoutput` / output-trigger
derivation when `serverOwnsPostGeneration` is true, there is no fallback
derivation for that failed server pass.

### A3 — Provider coverage

Unsupported provider shapes cannot be server-routed. Already handled:
`resolveServerCompletionRoute` returns `unsupported` and hard-fails on the
completion path; `/generate/chat` performs its resolver check in
`prompt/chatDispatch.ts` and emits explicit unsupported-provider errors with no
browser fallback. The routing decision is shared through `resolveProviderCapability`
so the completion and `/chat` paths cannot drift on capability. Today `/chat`
still rejects NovelAI/NovelList, plugin providers, WebLLM, Ooba OpenAI-compatible
chat shapes, and unknown OpenAI-compatible models. This is a support cap, not a
thinness leak. Keep the hard-fail explicit.

## B. Fine In The Browser

- **B1 (permanent, no-port):** notification, TTS playback (server emits the `tts`
  side-effect, browser plays), image-gen call + inlay-screen rendering, emotion
  selection → transient `CharEmotion`, HypaV3 progress UI, input plumbing, plugin
  runtime.
- **B2 (acceptable, optimizable):** auto-continue/resend recursion (control flow
  that re-issues `sendChat`); final-message persistence via command replay
  (`dispatchPersistGenerationResult`); stage-timing metadata. The assembly-time
  scriptstate replay (`dispatchPatchChatScriptstate`) is **no longer** part of the
  generation hot path — C-A1 moved it server-side (see below).

### C-A1 — the smallest post-gen batch (no parity blocker) — DONE

Assembly-time scriptstate persistence now lives in `/generate/chat`. The server
already computed the delta (`assemble.ts::buildChatVarMutations`) and emits it as a
`message_patch`; the route persists it via `persistAssemblyMutations` →
`applyJsonCommandMutation` (one revision bump, one event, rollback on failure) for
persisting modes and returns the bumped revision on the `info` frame. The browser
keeps `applyServerMessagePatch` (projection-only) and reconciles its cached command
revision (`reconcileServerCommandRevision`) instead of re-POSTing the delta. The
scriptstate command route stays for slash/plugin/manual writes; preview /
preview_prompt stay read-only. Proven by zero outbound `…/scriptstate` POSTs in
`sendChat.fixtures.serverBacked.test.ts` Describe B (plus persistence + revision
reconciliation), and the C-A1 persistence / 423 assertions in
`generation.chat.test.ts`.

## Non-Targets

- Group chat — **legacy**, slated for client removal; do not add a server group
  model. See [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md).
- Do not port browser UI/display ownership.
- Do not widen provider support while removing prompt/post-gen branches.
- A1/A2 are landed. Do not mix group-chat removal, any newly justified audit-rule
  hardening, event-patching, and docs-only reconciliation in one batch.
- **Durable/resumable generation** (survive client disconnect, server-owned result
  persistence, reconnect/replay) is a separate future workstream, **not** part of
  these slices. C-A1 / slice 2 moves persistence server-side as a _prerequisite_,
  not this goal. See [`../plan.md`](../plan.md) "Out Of Scope Here".

## Proof Leads

- `server/fastify/__tests__/generation.chat.test.ts`
- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `src/ts/process/__tests__/sendChat.serverPreview.test.ts`
- `src/ts/process/request/tests/serverChat.test.ts`
- `src/ts/process/request/tests/serverCompletion.test.ts`
- `src/ts/process/__tests__/command.projectionGuard.test.ts`

## Verification Coverage

The former proof-only coverage shard is consolidated with its canonical status record.

Date: 2026-05-30

### Current Proof

Provider routing and completion:

- `src/ts/process/request/tests/serverCompletion.test.ts`
- provider-specific tests under `server/fastify/__tests__/`

Server chat route and prompt assembly:

- `server/fastify/__tests__/generation.chat.test.ts`
- prompt helper tests under `server/fastify/__tests__/`

Browser/server bridge and post-generation:

- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `src/ts/process/__tests__/sendChat.serverPreview.test.ts`
- `src/ts/process/request/tests/serverChat.test.ts`
- `src/ts/process/__tests__/sendChatContext.test.ts`
- `src/ts/process/__tests__/command.projectionGuard.test.ts`

### Expected Coverage Shape

A chat-process/runtime batch should prove:

- exact mode: `send`, `continue`, `preview`, `preview_prompt`, or `regenerate`
- the source branch removed or server-owned, OR the send classified `unsupported`
  (never a silent local fallback) — for **A1**, that a classifier returns
  `unsupported`/`server` (not `local`) in Fastify mode and `assembleLocalSendChatPrompt`
  is unreachable for the supported subset
- user/message rows created, updated, truncated, restored, or untouched
- command revision and active-writer behavior for any persisted mutation — for
  **C-A1**, zero outbound `patchChatScriptstate` POSTs for an assembly-time var
  write, and a non-active-writer `/chat` does not persist
- SSE frames and terminal behavior
- local restoration / rollback behavior
- browser-only side effects preserved (B1) or explicitly no-port
- provider unsupported shapes still fail explicitly in Fastify mode (**A3**)

### Known Gaps

- Server prompt assembly is on by default via `useServerPromptAssembly`;
  the classifier exists, and the server subset includes text sends, image-input
  multimodal/asset sends, non-interactive Lua edit/input hooks, and the image-gen
  instruction. Non-vision caption fallback, interactive Lua dialogs, and pluginV2
  stay explicit `unsupported`.
- A2 is server-owned on the server-dispatch path; the local-assembly/completion
  path still uses the browser post-generation derivation only when the flag is
  explicitly off or outside Fastify mode.
  If server post-generation derivation throws, `/generate/chat` currently omits
  the post-generation frame and the browser does not run the skipped local
  derivation fallback.
- Final-message persistence still depends on a browser-issued command (**B2**,
  acceptable). Assembly-time scriptstate persistence is route-owned.
- `/generate/completion` and `/generate/chat` now share the pure
  `resolveProviderCapability` routing decision. Their per-path request derivation
  and reason prose still differ, so check source before adding provider claims.
- Group chat is legacy; the dead UI branches are removed and residual cleanup is
  not a coverage target.
