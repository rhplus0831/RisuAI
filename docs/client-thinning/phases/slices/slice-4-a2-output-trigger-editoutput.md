# Slice 4: A2 — server output-trigger + `editoutput`

Date: 2026-05-30

| | |
| --- | --- |
| **Work-order item** | 4 (A2) |
| **Blocker** | A2 (post-generation durable derivation; server path landed by this slice) |
| **Depends on** | **slice 3b** (landed server Lua support) for Lua output/editoutput work; pluginV2 remains permanent unsupported |
| **Reference** | [`../../reference/post-generation-and-persistence.md`](../../reference/post-generation-and-persistence.md) §A2 |
| **Goal** | Give the server a post-generation pass that runs the `'output'` trigger and `editoutput` over the just-generated assistant text, deriving the durable scriptstate/message delta server-side, and remove the browser's authority over it. |
| **Status** | **DONE** in commit `fb279717`. |

## Outcome

- After generation, the server runs: the **pre-trigger run-var pass**, the
  **`'output'` trigger**, and **`editoutput`** over the completion text — deriving
  the durable `chat.scriptstate` / `chat.message` / final-text mutations that
  previously only the browser produced.
- The scriptstate delta is persisted by the C-A1/slice-2 machinery; message patch,
  final text, resend, and revision are surfaced on `done.postGeneration`, and the
  **browser branch is removed** for the server-owned path.
- Unlike C-A1's assembly-time delta, this delta is a function of the
  **just-generated text**; this slice added the server equivalent.

## The distinction to hold (do not conflate with C-A1)

There are **two** scriptstate deltas (reference §"The one distinction that
matters"):

- **Assembly-time** (`'start'` trigger + run-var) — server already computes it;
  **slice 2 / C-A1** persists it. *Not this slice.*
- **Post-generation** (`'output'` trigger + `editoutput`, derived from the
  assistant text) — server path landed here. *This slice.*

## Preconditions

- [x] **Slice 3b** landed: the server can run the
      trigger/script machinery the `'output'` arms need. The reusable pieces
      already exist — `runTrigger` accepts `'output'` (`triggers.ts:103`), the
      `setvar`/`v2SetVar` arms are durable (`prompt/triggers.ts:155-164`), and
      `processScript(…, 'editoutput', …)` is implemented (`scripts.ts:63,319`) but
      never *called*. Lua output/editoutput can use the landed VM; pluginV2
      output/editoutput stays permanent unsupported.
- [x] **Slice 2 / C-A1** landed (recommended): reuse its route persistence path
      for the post-gen delta instead of building a second writer.

## Historical Step-by-step

The checklist below records the route shape and implementation path before slice
4 landed. Current behavior is summarized in the Outcome and checked items.

### Orient

1. Read [`../../reference/post-generation-and-persistence.md`](../../reference/post-generation-and-persistence.md)
   §"A2 — durable post-gen derivations" and the master post-gen table. The browser
   owner is `applyOutputTrigger` (`postGeneration/outputTrigger.ts:19-35`), called
   from `orchestrateResponse` once per branch after the response text is written,
   before auto-continue (`orchestrateResponse.ts:119` streaming / `:165`
   non-streaming).
2. Note `applyOutputTrigger` does **two** durable things: (a) the pre-trigger
   run-var pass (`outputTrigger.ts:23-27` → `chatVar.svelte.ts:31-40`), and (b)
   `runTrigger(currentChar, 'output', { chat })` (`:29`), which may write
   `scriptstate` and mutate `chat.message`, returning `resendChat = !!sendAIprompt`.
3. Note `editoutput` runs via `processScriptFull(…, 'editoutput', …)`: streaming
   per chunk (`streamResponse.ts:107-117`) and non-streaming
   (`nonStreamResponse.ts:68-82`, written back `:92-120`). It mutates the **final
   saved response text** (`result2.data`) and may set `emoChanged`.
4. Historical server gap: before this slice, the server used the trigger runner
   for `'start'` and submit-time `'input'`, but not after generation.
   `'editoutput'` existed in `ScriptMode` (`scripts.ts:63`) but was not invoked
   in the provider-dispatch path.

### Implement — server post-gen pass

5. Add a **post-generation pass** in the server generation path (after the
   completion text is produced in the `/chat` provider-dispatch flow,
   `generationChat.ts` + `chatDispatch.ts`/`providerTransport.ts`). In order,
   mirroring `applyOutputTrigger`:
   1. **pre-trigger run-var pass** over the live chat (the server already has the
      run-var machinery used at assembly — reuse it for the post-gen text);
   2. **`runTrigger(char, 'output', { chat })`** — the runner already accepts
      `'output'`; this is the first invocation of that mode server-side. Capture
      `varChanged`, the mutated `chat.message`, and `sendAIprompt`;
   3. **`processScript(completionText, 'editoutput', …)`** over the final text —
      it is implemented and only needs calling.
6. **Surface the derived delta.** The `message_patch` contract is the natural
   carrier for the scriptstate/message delta; the final-text edit rides on the
   persisted message. Persist the durable part through the **slice-2 route
   persistence** path (do not add a second writer). Bump revision once, emit one
   event — same invariants as C-A1.
7. **`resendChat` / auto-continue.** `runTrigger('output')` can request a resend
   (`sendAIprompt`). Auto-continue/resend recursion is **B2 control flow** that
   re-issues `sendChat` — keep that orchestration in the browser; the server only
   needs to *report* whether a resend was requested (so the browser can re-issue).
   Do not move the recursion server-side.

### Implement — remove the browser authority

8. For the server-owned path, **remove the browser's durable derivation**: gate
   off / delete the `applyOutputTrigger` durable writes
   (`orchestrateResponse.ts:119,165`) and the `editoutput` mutation
   (`streamResponse.ts:107-117`, `nonStreamResponse.ts:68-82`) when the server
   owns the post-gen pass. The browser keeps applying the resulting projection
   patch and keeps B1 effects (inlay-screen render, TTS, notification, emotion) —
   those are **not** A2 (see the master table: inlay-screen text write is
   A2-adjacent and rides on `.data`; TTS/notification/emotion are B1).

### Prove

9. **Server output-trigger test:** a server `'output'` pass over a known
   completion that derives a `setvar`/`v2SetVar` scriptstate delta and/or a
   message mutation, surfaced + persisted (revision bumps, scriptstate written).
   New cases in `generation.chat.test.ts`.
10. **Server `editoutput` test:** the saved response text reflects the
    `editoutput` transform server-side.
11. **Flip browser behavior:** `outputTrigger.test.ts:61` pins the browser
    `applyOutputTrigger` → `runTrigger('output')` + run-var pass + `resendChat`.
    For the server-owned path, update it so the browser no longer performs the
    durable derivation (it consumes the server's patch + reports resend).
12. **No silent fallback / parity:** extend the serverBacked sweep with an
    output-trigger fixture; assert server == local golden for the post-gen delta
    and zero browser-side durable writes.

### Land

13. Run the [shared verification](README.md#shared-verification-run-before-and-after-every-slice).
14. Update docs: flip the **Output triggers (`'output'`)** row in
    [`../../reference/server-assembler-parity.md`](../../reference/server-assembler-parity.md)
    and the A2 rows in
    [`../../reference/post-generation-and-persistence.md`](../../reference/post-generation-and-persistence.md);
    update [`../../status/sendchat-thinning.md`](../../status/sendchat-thinning.md).
    This is the last A-blocker — confirm the [phase-5 closeout](../phase-5-closeout.md)
    exit criteria for the A-items.

## Decision points

- **Where the post-gen pass lives.** It must run after the provider produces text
  but within the server request lifecycle so the derived delta can be persisted
  behind the active-writer guard. Co-locate with the dispatch reuse in
  `generationChat.ts`/`chatDispatch.ts`.
- **What is missing.** The gap is not the generic trigger runner: it already
  supports the modes used by assembly-time hooks. The missing piece is the
  post-generation route invocation/persistence for `runTrigger('output')` and
  `processScript(..., 'editoutput')`. Lua can use the landed VM; pluginV2 remains
  no-port.

## Scope guard

A2 only — the durable post-gen derivation. Do **not** move B1 effects
(TTS/notification/emotion/image-gen/inlay render) server-side. Do **not** move the
auto-continue/resend recursion server-side (B2 control flow stays browser). Do not
re-open C-A1's assembly-time delta. Do not bundle group-chat removal.

## When this slice is done

- [x] The server runs the run-var pass, `'output'` trigger, and `editoutput` over
      the completion text, deriving the durable delta. (`runServerPostGeneration`
      in `assemble.ts`, wired via `providerTransport.ts`'s `postGeneration` hook.)
- [x] The delta is persisted via the slice-2 route path (revision bump + event),
      and the browser's durable derivation is removed for the server path.
      (`generationChat.ts::buildPostGenerationFrame` → `persistAssemblyMutations`;
      `orchestrateResponse` `serverOwnsPostGeneration` skips `applyOutputTrigger` +
      `editoutput`; `applyServerBackedTerminal` consumes the patch + final text.)
- [x] Resend is reported to the browser, not driven server-side; B1 effects intact.
      (`done.postGeneration.resendChat` → `applyServerBackedTerminal` →
      `runStage4` resend; inlay render + TTS stay browser.)
- [x] Server-side output-trigger/`editoutput` tests are green; the browser pin is
      flipped; the A2 parity rows are updated — closing the last A-blocker.
      (`generation.chat.test.ts`, `sendChat.fixtures.serverBacked.test.ts`,
      `orchestrateResponse.test.ts`; parity/status/closeout docs updated.)

## Scope notes (decisions taken)

- **What the server persists vs surfaces.** The post-gen pass persists the durable
  **scriptstate delta** (run-var + output-trigger `setvar`/`v2SetVar`) through the
  slice-2 writer. The `editoutput`'d + run-var'd **final text** rides on
  `done.postGeneration.finalText`; the browser writes it onto the assistant message
  and its existing generation-result command (B2) persists it — B2 stays
  browser-owned (the C-A1 route-backed test pins that the generation-result POST
  still fires). The server does **not** persist the assistant message, avoiding a
  double-write with B2.
- **Output-trigger message surgery** (impersonate/cutchat/modifychat) is surfaced
  in the post-gen `message_patch` for the projection (matching today's
  projection-only behavior), not separately persisted — the scriptstate delta is
  the durable A2 derivation this slice lands. `editoutput`-that-adds-inlay-markers
  is the one exotic ordering the terminal pass does not specially reconcile.
- **Streaming display.** The server streams raw tokens for live display; the
  `editoutput`/run-var transform is applied once the full text is known and
  surfaced on `done`. The inlay-screen render (B1) runs once, at terminal time,
  over the server-owned final text.
