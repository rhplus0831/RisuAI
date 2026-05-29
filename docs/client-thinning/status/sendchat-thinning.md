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
| Prompt assembly | **Server-mandatory for the text-send subset** (`resolveServerPromptAssembly`); Browser (`assembleLocalSendChatPrompt`) only when `!isFastifyServer` or the flag is off | Slice 1 landed the classifier (`request/serverPromptAssembly.ts`): in Fastify mode + `useServerPromptAssembly`, the pure-text subset routes `server`, every content class routes `unsupported` (hard fail). Blocker **A1** content classes (3a/3b/3c) graduate the rest. |
| Provider dispatch | **Server** (`/generate/completion`) | `resolveServerCompletionRoute`; `local` only if `!isFastifyServer`; unsupported → hard fail (**A3**). |
| Token streaming → rows | Browser | Writes the projection. |
| Post-generation | **Browser** | `editoutput`, inlay-screen, output trigger, auto-continue, IGP (blocker **A2** for the durable ones). |
| Stage-4 closeout | **Browser** | Notification, emotion, image-gen, TTS, stage metadata (B1/B2). |
| HypaV3 memory | **Server** | Persistence + jobs server-side; progress UI is browser (B1). |
| Durable persistence | **Command-backed** | Browser issues commands; generation routes are stateless re the chat blob (B2). |

## A. Hard Blockers

### A1 — Prompt-assembly content parity

The server `/generate/chat` assembler (`server/fastify/src/prompt/`) is at parity
for run-vars, CBS/variable expansion, regex scripts, templates, token budget,
lorebook + depth prompts, start triggers, and HypaV3 selection. It is NOT at
parity for:

- **Multimodal / asset inlining** — `prompt/history.ts` hardcodes `NO_ASSETS` and
  the route never binds the `AssetLookup` seam; the request's `inlayAssets` field
  is accepted but unused. Image/asset prompts lose their bytes.
- **Non-vision image-caption fallback** — browser-only (`runImageEmbedding`).
- **Image-gen instruction** (`buildInlayViewInstruction` / `newGenData`) — not
  ported.
- **Lua `editRequest`** — server runs identity (`templates.ts`: `editRequest =
  rows => rows`).
- **Lua + plugin-V2 `editprocess` script hooks**, and the input-trigger /
  `editinput` scripts at submit — server does regex scripts only.

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
(asset/image-gen/Lua/plugin), a non-user-message send, a group character, and a
non-server-routable provider route `unsupported` and hard-fail. The soft
`unavailable` escape (the silent non-string-`send` → local fall-through) is
deleted. `local` is reached only when `!isFastifyServer` or the flag is off.

**Remaining A1 work — content graduation (slices 3a/3b/3c):** each later content
slice ports one class to the server assembler and flips its detector in the
classifier from `→ unsupported` to `→ server`. Each detector is already isolated
behind its own named predicate. Until then the classifier reads
`useServerPromptAssembly` as the experimental master enable; removing that flag is
the END of the sub-family, after the last content class graduates.

### A2 — Post-generation durable derivation (no server path)

- **Output trigger** — `runTrigger(char, 'output', …)` mutates scriptstate and
  messages after generation. The server has **no `'output'` invocation at all**:
  `server/fastify/src/prompt/triggers.ts` declares the mode but only wires
  `runStartTrigger` (`'start'`). Needs a server output-trigger pass.
- **`editoutput` script processing** — mutates the final response text
  (`postGeneration/streamResponse.ts`, `nonStreamResponse.ts`). Needs server-side
  output-script execution.

Both depend on server prompt/script execution parity (shares machinery with A1's
Lua/plugin gap). Sequence after A1.

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
  that re-issues `sendChat`); result/scriptstate persistence via command replay
  (`dispatchPersistGenerationResult`, `dispatchPatchChatScriptstate`); stage-timing
  metadata. Optional later win: route-direct persistence closes a small durability
  window (browser crash between generation and replay) and saves a round-trip.

### C-A1 — the smallest post-gen batch (no parity blocker)

Move assembly-time scriptstate persistence into `/generate/chat`. The server
already computes the delta (`assemble.ts::buildChatVarMutations`) and emits it as a
`message_patch`; the browser replays it via `dispatchPatchChatScriptstate`. The
write logic already exists server-side. The change: route persists + returns the
new revision; the browser stops replaying and reconciles to that revision. Does
not depend on A1. Proof: extend the server-preview/serverBacked sendChat fixtures
to assert zero outbound `patchChatScriptstate` POSTs for an assembly-time var
write, and that a non-active-writer `/chat` does not persist.

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
