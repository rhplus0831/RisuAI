# Reference: Post-Generation & Persistence (C-A1 + A2)

Date: 2026-05-29

Backs Phase 4 work-order items **2** (C-A1 — move assembly-time scriptstate
persistence into `/generate/chat`, retire the command replay) and **4** (A2 —
server output-trigger + `editoutput`). Both live in the post-generation pipeline
and the browser↔server persistence bridge. Line anchors may drift; symbols are
the stable handle. All paths from the repo root.

## The one distinction that matters

There are **two** scriptstate deltas, often conflated:

- **Assembly-time** scriptstate (the `'start'` trigger + run-var pass). The server
  computes this (`assemble.ts::buildChatVarMutations`), emits it as a
  `message_patch`, persists it in `/generate/chat` for persisting modes, and
  returns the bumped revision over SSE. **C-A1 is done.**
- **Post-generation** scriptstate (the `'output'` trigger + `editoutput`, derived
  from the just-generated assistant text). The server has **no path** for this —
  this is the **A2** blocker (needs server post-gen script/trigger execution).

A2 needs the server scripting machinery and should sequence after A1's Lua hook
parity.

## Stage taxonomy (there is no `runStage1/2/3`)

The post-gen "stages" are numeric progress markers via
`setProcessStage(n)` → the `chatProcessStage` store (`index.svelte.ts:48,132`),
**not** a `runStageN` family. Only `runStage4` is a named helper. The coordinator
is `sendChat` (`src/ts/process/index.svelte.ts`):

| Phase | Helper | Marker | Site |
| --- | --- | --- | --- |
| 1 prompt assembly | `assembleServerBackedSendChat` / `assembleLocalSendChatPrompt` | `setProcessStage(1)` | `index.svelte.ts:163` / `:203` |
| 2/3 dispatch | `dispatchRequest` (local) or server-dispatch reuse | `setProcessStage(3)` | `index.svelte.ts:233-275` |
| 3→end response | `orchestrateResponse` | — | `index.svelte.ts:277` |
| (server terminal) | `applyServerBackedTerminal` | — | `index.svelte.ts:314` |
| 4 closeout | `runStage4` | `setProcessStage(4)` | `index.svelte.ts:328` |
| persist | `persistServerBackedGenerationResult` | — | `index.svelte.ts:351` |

## `orchestrateResponse` — the post-dispatch orchestrator

`orchestrateResponse(args)` (`postGeneration/orchestrateResponse.ts:73-75`;
return union `:19-28`). Order:

- **Streaming** (`:96`): `consumeStreamResponse` (`:97`) → `addRerolls` (`:117`)
  → **`applyOutputTrigger`** (`:119`) → `runInlayScreen` + inlay projection write
  (`:129-142`) → streaming `sayTTS` (`:143-145`).
- **Non-streaming** (`:146`): `applyNonStreamResponse` (`:147`) → `addRerolls`
  (`:161-163`) → **`applyOutputTrigger`** (`:165`) → `triggerChat` projection
  write (`:171-175`).
- **Both** then: `evaluateAutoContinue` (`:181`; early-return on continue) →
  `evaluateIgp` (`:191`) → return `done` (`:198`).

The output trigger runs once per branch, after the response text is written,
before auto-continue.

## `runStage4` — closeout (B1/B2 effects)

`runStage4(args)` (`postGeneration/runStage4.ts:48`). Effects in order:
stage-3 duration + transition (`:64-70`); resend short-circuit (`:72-75`);
desktop notification (`:77-79`, `notification.ts:1-10` — Notification API, no
projection write → **B1**); provider emotion (`:81-86`); emotion embedding
fallback (`:92-100`); emotion LLM fallback (`:102-111`); image-gen stable
diffusion (`:112-114`, `imggenStableDiff.ts` — emotion/inlay side effect → **B1**);
`finalizeStage4` (`:117`). `finalizeStage4` (`stage4Finalize.ts:23-41`) writes
stage timings + `generationInfo` onto the last message via a trusted projection
write (`:35-39`) — metadata, B2-adjacent.

## A2 — durable post-gen derivations (hard blocker, no server path)

### Output trigger — `runTrigger(char, 'output', …)`

The only production call site in `src/ts/` is
`postGeneration/outputTrigger.ts:29` (inside `applyOutputTrigger`, `:19-35`):

```ts
const triggerResult = await runTrigger(currentChar, 'output', { chat })
```

`applyOutputTrigger` does two durable things:

1. **Pre-trigger run-var pass** (`outputTrigger.ts:23-27`): runs
   `runCurrentChatFunction` = `runSendChatMessageVariables`
   (`sendChatPromptAssembly.ts:54-60`) over the live chat under a projection
   write. It re-parses each `message.data` with `runVar: true`, evaluating CBS
   `{{setvar}}` which calls `setChatVar` → durable `chat.scriptstate` write
   (`src/ts/process/scripts/chatVar.svelte.ts:31-40`).
2. **The `'output'` trigger** (`:29`): the browser trigger engine
   (`src/ts/process/triggers.ts`) runs `setvar`/`v2SetVar` effect arms that write
   `chat.scriptstate`, and may mutate `chat.message` (impersonate/cutchat/
   modifychat). Returns `{ chat, sendAIprompt }`; `applyOutputTrigger` returns
   `triggerChat` (the mutated chat) + `resendChat = !!sendAIprompt` (`:30-34`).
   The orchestrator writes `triggerChat` back to the projection
   (`orchestrateResponse.ts:131-133` / `:171-175`).

**Why A2, not B1/B2:** it derives durable state (`chat.scriptstate` and
`chat.message` edits) *as a function of the just-generated assistant text*, with
no server equivalent. Browser behavior is pinned by
`src/ts/process/__tests__/outputTrigger.test.ts:61`.

### `editoutput`

`editoutput` runs via `processScriptFull(…, 'editoutput', …)`:
streaming per chunk (`postGeneration/streamResponse.ts:107-112`, written back
`:113-117`) and non-streaming (`postGeneration/nonStreamResponse.ts:68-73` and
the continue case `:77-82`, written back `:92-120`). It mutates the **final saved
response text** (`result2.data`) and may set `emoChanged`. Durable → grouped with
the output trigger as A2.

### Server cross-check

The server runs `processScript` only with `'editprocess'`
(`prompt/history.ts:292,452`); `'editoutput'` exists in `ScriptMode`
(`prompt/scripts.ts:63`) but is never invoked. The provider-dispatch path
(`routes/generationChat.ts`, `prompt/chatDispatch.ts`, `prompt/providerTransport.ts`)
has no `runTrigger` call and no `editoutput`. **Reusable machinery for A2:** the
ported `runTrigger` already accepts the `'output'` mode value and has durable
`setvar`/`v2SetVar` arms returning `varChanged` (`prompt/triggers.ts:155-164`);
`processScript(…, 'editoutput', …)` is fully implemented and only needs to be
*called* on the completion text; the `message_patch` contract is the natural
carrier for any post-gen delta. (Lua/pluginV2 hooks remain unported — see
[`server-assembler-parity.md`](server-assembler-parity.md).)

## Master post-gen table

| Effect | Owner (browser) | Durable? | Server path? | Class |
| --- | --- | --- | --- | --- |
| `editoutput` on response text | `streamResponse.ts:107-112`, `nonStreamResponse.ts:68-82` | **Yes** (saved `.data`) | No (server runs `'editprocess'` only) | **A2** |
| Pre-trigger run-var pass | `outputTrigger.ts:23-27` → `chatVar.svelte.ts:31-40` | **Yes** (`scriptstate`) | Partial (server run-var at assembly, not post-gen) | **A2** |
| `runTrigger('output', …)` | `outputTrigger.ts:29` | **Yes** (`scriptstate`+`message`) | No (`'output'` never invoked) | **A2** |
| Inlay-screen text write | `orchestrateResponse.ts:129-142` | Yes (rides on `.data`) | No | A2-adjacent |
| Streaming / terminal TTS | `orchestrateResponse.ts:143-145`; server `side_effect kind:'tts'` (`generationChat.ts:337-346`) | No | Yes (server emits, browser plays) | **B1** |
| Desktop notification | `runStage4.ts:77-79` | No | No (browser API) | **B1** |
| Emotion + imggen | `runStage4.ts:81-114` | No | Partial | **B1** |
| Stage timing / `generationInfo` | `stage4Finalize.ts:23-41` | Yes (metadata) | Server builds `generationInfo` | B2-adjacent |
| **Assembly-delta persistence** | route `persistAssemblyChatVars` (replaced `serverBackedSendChat.ts` replay) | Yes | **Yes** — route persists + returns the bumped revision over SSE | **C-A1 — DONE** |
| **Persist generation result (final message)** | `index.svelte.ts:351` → `POST …/generation-result` | Yes | Route exists; route doesn't auto-persist | **B2** |

## C-A1 — the persistence bridge

> **Status (2026-05-29): LANDED.** `/generate/chat` now persists the
> assembly-time chat-var delta itself (`persistAssemblyChatVars` →
> `applyJsonCommandMutation`) and returns the bumped revision on the `info`
> frame; the browser dropped the `dispatchPatchChatScriptstate` re-POST and
> reconciles its cached command revision instead. The subsections below keep the
> pre-C-A1 round-trip for context; the *current* behavior is in **What C-A1
> changed**.

### How the browser used to replay the patch (pre-C-A1)

`applyServerMessagePatches` (`serverBackedSendChat.ts`): for each patch with
chat-var mutations it snapshotted state, applied the patch to the live chat,
then re-emitted a scriptstate command:

```ts
dispatchPatchChatScriptstate(liveChat.id, scriptstatePatch, deleteKeys, previous)
```

This ran **at assembly time**, because the server computes the var delta while
building the prompt. C-A1 removed this re-POST; `applyServerMessagePatch` (the
projection-only write) stays. The final message is still persisted separately by
`persistServerBackedGenerationResult` (`serverBackedSendChat.ts`), invoked by the
coordinator at `index.svelte.ts:351` after `runStage4` (B2, unchanged).

### The two dispatch helpers (browser → command routes)

Defined in `src/ts/chatCommands.ts`:

- `dispatchPatchChatScriptstate` (`chatCommands.ts:494-513`) →
  `patchChatScriptstateCommand` (`src/ts/server/commands.ts:1653-1666`) →
  **`PATCH /api/v1/commands/chats/:chatId/scriptstate`**, body
  `{ baseRevision, patch, deleteKeys }`, response `{ revision, event, chatId }`.
- `dispatchPersistGenerationResult` (`chatCommands.ts:473-492`) →
  `persistGenerationResultCommand` (`commands.ts:2132-2144`) →
  **`POST /api/v1/commands/chats/:chatId/generation-result`**, body
  `{ baseRevision, generationResult: { message, targetMessageId? } }`.

Both go through `runChatCommand`/`runMessageCommand` (`chatCommands.ts:85-98`),
gated by `canUseServerCommands()`, optimistic with a `restoreChatState(previous)`
rollback.

### The round-trip, before vs after C-A1

**Before (the round-trip C-A1 removed):**

1. Server mutates its own clone's `chat.scriptstate` during assembly (start
   trigger + run-var).
2. `buildChatVarMutations` (`assemble.ts:596-607`) diffs it → `chatVarMutations`.
3. Route emits `message_patch` (`generationChat.ts:281-283`).
4. Browser ingested it, applied it to the projection (`applyServerMessagePatch`),
   **and POSTed the same delta back** as a scriptstate command.
5. Server re-applied it to the very chat it just mutated.

**After C-A1 (current):** steps 1–3 unchanged. The route then persists
`result.mutations.chatVarMutations` itself for persisting modes — it has the diff
and reuses the JSON-command machinery via `persistAssemblyChatVars` →
`applyJsonCommandMutation` (one revision bump, one `chat.scriptstate.updated`
event, rollback on failure) — and returns the new revision on the `info` frame.
The browser keeps `applyServerMessagePatch` (projection-only) and reconciles its
cached command revision (`reconcileServerCommandRevision` →
`setCachedServerCommandRevision`); the round-trip's steps 4–5 are gone. The
scriptstate command route stays for slash/plugin/manual writes but leaves the
generation hot path. Preview / preview_prompt stay read-only.

**Statelessness invariant this flipped:** `generation.chat.test.ts` — a `setvar`
start trigger emits `chatVarMutations: [{ key: '$score', before: null, after: '9' }]`
and bootstrap afterwards now shows `revision: 2` with the written
`scriptstate: { $score: '9' }` (the persistence assertion), while `mode: 'preview'`
stays `revision: 1` / `scriptstate: undefined`, and a non-active-writer `/chat`
423s before persisting.

## Active-writer gating (relevant to C-A1's proof)

Server guard `registerActiveWriterGuard` (`server/fastify/src/activeWriter.ts:20-26`,
registered `app.ts:157`) is a `preHandler` that returns **`423 active_writer_stale`**
for server-owned mutations unless the request carries the current writer session
(`isActiveWriter`, `activeWriter.ts:28-31`). `isServerOwnedMutation`
(`activeWriter.ts:49-65`) includes **both** `POST /api/v1/generate/chat`
(`:58`) and all `/api/v1/commands/*` (`:54`). The browser attaches the
`risu-writer-session` header (`activeWriterSessionHeader()`,
`src/ts/server/activeWriterSession.ts:11`) to the `/chat` request
(`request/serverChat.ts:116`) and every command POST (`server/commands.ts:2198`).

**Implication:** because `/generate/chat` and the scriptstate command sit behind
the *same* guard, "a non-active-writer `/chat` does not persist" already holds
structurally at `activeWriter.ts:21-25` — moving persistence into the route does
not weaken it. The C-A1 proof should still assert it (a non-active-writer `/chat`
returns 423 before any mutation).

## Proof obligations

- **C-A1 (satisfied):** `sendChat.fixtures.serverBacked.test.ts` Describe B now
  records `/api/v1/commands/*` calls and asserts **zero** `PATCH …/scriptstate`
  POSTs for an assembly-time var write, that the route persisted (bootstrap shows
  the written scriptstate + bumped revision), and that the cached command
  revision reconciled (the follow-up `generation-result` POST carries the bumped
  `baseRevision`). `generation.chat.test.ts` expects persistence, keeps preview
  read-only, and proves a non-active-writer
  `/chat` 423s before persisting.
- **A2:** a server `'output'` trigger pass + `editoutput` execution that derive
  the post-gen scriptstate/message delta and surface it (patch or persisted),
  with the browser branch removed; sequence after A1 Lua hook parity.

See [`proof-points.md`](proof-points.md) for the test files and harness mechanics.
