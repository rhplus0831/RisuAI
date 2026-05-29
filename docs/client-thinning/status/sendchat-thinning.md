# Chat-Process Ownership (sendChat)

Date: 2026-05-29

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

| Stage | Default owner | Notes |
| --- | --- | --- |
| Pre-send input | Browser | UID/input plumbing; rows persist via commands (B1). |
| Prompt assembly | **Server-mandatory for the text-send subset + multimodal/asset on vision models** (`resolveServerPromptAssembly`); Browser (`assembleLocalSendChatPrompt`) only when `!isFastifyServer` or the flag is off | Slice 1 landed the classifier (`request/serverPromptAssembly.ts`); **slice 3a graduated multimodal/asset** (image-input models → `server`). Remaining `unsupported`: non-vision caption (class 2), image-gen (3c), Lua hooks (3b); pluginV2 is permanent unsupported. |
| Provider dispatch | **Server** (`/generate/completion`) | `resolveServerCompletionRoute`; `local` only if `!isFastifyServer`; unsupported → hard fail (**A3**). |
| Token streaming → rows | Browser | Writes the projection. |
| Post-generation | **Browser** | `editoutput`, inlay-screen, output trigger, auto-continue, IGP (blocker **A2** for the durable ones). |
| Stage-4 closeout | **Browser** | Notification, emotion, image-gen, TTS, stage metadata (B1/B2). |
| HypaV3 memory | **Server** | Persistence + jobs server-side; progress UI is browser (B1). |
| Durable persistence | **Mixed** | Assembly-time scriptstate delta is now persisted by `/generate/chat` itself (**C-A1, done**); final-message persistence is still command-backed (B2). |

## A. Hard Blockers

### A1 — Prompt-assembly content parity

The server `/generate/chat` assembler (`server/fastify/src/prompt/`) is at parity
for run-vars, CBS/variable expansion, regex scripts, templates, token budget,
lorebook + depth prompts, start triggers, HypaV3 selection, and **multimodal /
asset inlining (slice 3a)**. Remaining explicit content rows:

- **Multimodal / asset inlining** — **DONE (slice 3a).** `beginAssembly` binds a
  non-empty `AssetLookup` (`prompt/assetLookup.ts`): inlay bytes from the request
  `inlayAssets` (now populated by `serverBackedSendChat.ts`), asset/icon bytes
  from the store (`resolveStoredAssetImage`). Vision models → `server`.
- **Non-vision image-caption fallback** — browser-only (`runImageEmbedding`);
  routes `unsupported` (slice 3a class 2). No server path.
- **Image-gen instruction** (`buildInlayViewInstruction` / `newGenData`) — not
  ported (slice 3c).
- **Lua `editRequest`** — server runs identity (`templates.ts`: `editRequest =
  rows => rows`).
- **Lua `editprocess` hooks** and input-trigger / `editinput` scripts at submit —
  server does regex scripts only, although the VM runtime exists.
- **pluginV2 edit/replacer hooks** — permanent unsupported, not a port target.

These are *correctness* differences in the assembled prompt. Assembly is
all-or-nothing per send, so they cannot silently stay browser-side. Resolution:
port the class, or classify the send as server-unsupported — never a silent
fallback.

**Foundation primitive (landed, slice 1):** `resolveServerPromptAssembly`
(`src/ts/process/request/serverPromptAssembly.ts`) mirrors
`resolveServerCompletionRoute` and returns `local | server | unsupported`. It
replaced the boolean gate at `index.svelte.ts`: in Fastify mode with
`useServerPromptAssembly` on, the supported pure-text-send subset routes `server`
(local assembler unreachable for it), and **every** content class above
(image-gen/Lua/pluginV2/non-vision caption), a non-user-message send, a group
character, and a non-server-routable provider route `unsupported` and hard-fail. The soft
`unavailable` escape (the silent non-string-`send` → local fall-through) is
deleted. `local` is reached only when `!isFastifyServer` or the flag is off.

**Remaining A1 work — content graduation (slices 3b/3c):** each later content
slice ports one class to the server assembler and flips its detector in the
classifier from `→ unsupported` to `→ server`. **Slice 3a is done** (multimodal /
asset → `server` for image-input models; non-vision caption stays `unsupported`).
Each detector is isolated behind its own named predicate. The classifier still
reads `useServerPromptAssembly` as the experimental master enable; removing that
flag is the END of the sub-family, after the last content class graduates.

### A2 — Post-generation durable derivation (no server path)

- **Output trigger** — `runTrigger(char, 'output', …)` mutates scriptstate and
  messages after generation. The server has **no `'output'` invocation at all**:
  `server/fastify/src/prompt/triggers.ts` declares the mode but only wires
  `runStartTrigger` (`'start'`). Needs a server output-trigger pass.
- **`editoutput` script processing** — mutates the final response text
  (`postGeneration/streamResponse.ts`, `nonStreamResponse.ts`). Needs server-side
  output-script execution.

Both depend on server prompt/script execution parity (shares machinery with A1's
Lua hook gap). Sequence after A1.

### A3 — Provider coverage

Unsupported providers (NovelAI, Ooba, Plugin, WebLLM, non-vanilla OpenAI-compat)
cannot be server-routed. Already handled: `resolveServerCompletionRoute` returns
`unsupported` and hard-fails; the in-`/chat` dispatch mirrors that. A support cap,
not a thinness leak. No batch needed beyond keeping the hard-fail explicit.

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
`message_patch`; the route persists it via `persistAssemblyChatVars` →
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
- Do not combine A1 content classes, A2, and group-chat removal in one batch.
- **Durable/resumable generation** (survive client disconnect, server-owned result
  persistence, reconnect/replay) is a separate future workstream, **not** part of
  these slices. C-A1 / slice 2 moves persistence server-side as a *prerequisite*,
  not this goal. See [`../plan.md`](../plan.md) "Out Of Scope Here".

## Proof Leads

- `server/fastify/__tests__/generation.chat.test.ts`
- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `src/ts/process/__tests__/sendChat.serverPreview.test.ts`
- `src/ts/process/request/tests/serverChat.test.ts`
- `src/ts/process/request/tests/serverCompletion.test.ts`
- `src/ts/process/__tests__/command.projectionGuard.test.ts`
