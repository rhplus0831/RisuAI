# Sub-slice 3b-4: Input-trigger / `editinput` at submit

Date: 2026-05-29 (**landed**)

| | |
| --- | --- |
| **Series** | [Lua server port](README.md), sub-slice **4 of 4** |
| **Depends on** | **sub-slice 1** (the VM) |
| **Goal** | Add a **submit-time** server hook (before assembly) that runs the input trigger + `editinput` scripts, which rewrite the transcript before the user message is persisted. The structurally hardest sub-slice (it needs a *new* seam). |
| **Status** | **Done.** `assemble.ts` runs `runInputTrigger` (→ `runTrigger('input')`, `triggerlua` on the VM) before the user-message append and `applyEditInput` (Lua `editInput` → CBS → regex) over the appended user row; the `triggerlua` arm is wired in `triggers.ts::runTrigger` via an injected `runLua` seam. The route (`generationChat.ts::persistAssemblyMutations`) **owns** the post-`editinput` transcript write (decision below). The browser submit handler sends the raw user text for a server-backed send and skips both transforms. Verified green (`client-thinning:audit`, `api:test` 1302, `test` 881, `check` 0/0). |

## Decision (route-owned write)

The user-message transcript write is **route-owned** for the server path: the
browser ships the *raw* user text, the server runs the input trigger + `editinput`,
and the route persists the rewritten transcript itself (`persistAssemblyMutations`,
the `messages.replaced` arm, combined with the chat-var delta into one revision).
The route persists the transcript **only when a submit hook actually changed it**
(`submitTranscriptChanged` — an input-trigger rewrite or an `editinput` transform);
a plain send leaves the user-message write to the browser exactly as before, so
every trigger-less send (all existing fixtures) is byte-for-byte unchanged. The
dual-writer window for a transformed send (browser persists raw, route overwrites
with the transform) is safe under the optimistic-command conflict model: the route's
transform is the authoritative last write regardless of command ordering.

## The honest framing

Unlike `editRequest`/`editprocess`, there is **no existing server seam** for this.
In the browser it runs in the chat-screen submit handler
(`DefaultChatScreen.svelte:229-244`):

- input trigger — `runTrigger(char,'input',{chat})` (`:232`) can rewrite the whole
  transcript (`cha = triggerResult.chat.message`);
- `editinput` script — `processScript(char,messageInput,'editinput')` (`:240`); for
  `editinput`, Lua *does* fire (mapped to `editInput`, `scriptings.ts:1422-1423`),
  plus regex scripts.

These mutate the transcript **before** the message is appended/persisted and before
assembly. `/generate/chat` already persists assembly-time scriptstate, but it has
no submit-time hook that can rewrite the transcript before assembly; this slice
adds that seam.

## Do not conflate (stays browser, B1)

The same submit handler, *earlier*, has two **browser-owned** input-plumbing branches
that are **not** A1 and must not be pulled in here:
- slash-command text (`DefaultChatScreen.svelte:203-209`) → `processMultiCommand`;
- file-inlay insertion (`:211-216`) → appends `{{inlayed::<id>}}` markers.

## Step-by-step (sketch — refine against the VM + route shape)

1. Decide where the server runs the submit-time hook. The send mode's last message is
   the new user text (`serverPromptAssembly.ts` requires `role==='user'`/string). A
   pre-assembly step in `beginAssembly` (or the route, before `assemblePrompt`) runs
   `runTrigger(char,'input',{chat})` + the `editinput` script chain over the user
   message, producing the possibly-rewritten transcript that assembly then consumes.
2. Reuse the server trigger runner (`triggers.ts::runTrigger`) for the `'input'`
   mode — it already accepts the mode; the `triggerlua` arm becomes a VM call
   (replacing the no-op fall-through, `triggers.ts:817-834`). The regex `editinput`
   path is already at parity (`scripts.ts::processScript`, mode `'editinput'`).
3. Persist consequences correctly: an input trigger that rewrites the transcript
   changes what gets persisted as the user message. Ensure the route's persistence
   (active-writer, scriptstate delta) reflects the post-`editinput` transcript, not
   the raw input. This is the subtle part — coordinate with the C-A1 persistence
   (`generationChat.ts::persistAssemblyChatVars`) and B2 message persistence.
4. Classifier: covered by sub-slice 2's Lua-arm flip, but confirm an `editinput`-only
   Lua char routes `server` (and interactive-API ones stay `unsupported`).

## Prove

- `generation.chat.test.ts`: a char whose `'input'` trigger / `editinput` Lua rewrites
  the user message → the assembled prompt + the persisted transcript reflect the
  rewrite.
- `sendChat.fixtures.serverBacked.test.ts` Describe B: server == local golden for an
  `editinput` char.
- The two B1 branches (slash text, file-inlay) still run in the browser unchanged.
- Shared verification.

## When done

- [x] A submit-time server hook runs `runTrigger('input')` + `editinput` before
      assembly, at parity with the browser. (`assemble.ts::runInputTrigger` +
      `applyEditInput`, wired in `assemblePrompt` around `appendUserMessageRow`;
      the `triggerlua` arm runs the VM via `triggers.ts::runTrigger`'s injected
      `runLua` seam.)
- [x] The persisted transcript reflects the post-`editinput` rewrite.
      (`generationChat.ts::persistAssemblyMutations` route-owned write; proven by
      `generation.chat.test.ts` bootstrap assertions + the route-backed
      regex-editinput integration test in `sendChat.fixtures.serverBacked.test.ts`.)
- [x] The B1 input-plumbing branches remain browser-owned (unchanged). (The
      slash-command + file-inlay branches in `DefaultChatScreen.svelte::sendMain`
      are untouched; only the input-trigger + `editinput` transforms are skipped
      for the server path.)
- [x] Classifier routes editinput Lua → `server`; interactive-API Lua →
      `unsupported`. (Sub-slice 2's whole-Lua-arm flip already covers it; an
      explicit input/editinput-Lua → `server` test was added to
      `request/tests/serverPromptAssembly.test.ts`.)

## What landed

- **`triggers.ts`** — `TriggerRunContext.runLua` seam + a `case 'triggerlua'` arm
  in `runTrigger` that calls the VM via the seam (mirroring the SPA's
  `runScripted(effect.code, {...})`), `engine.setChat` re-point + `stopSending`
  fold. When no runner is injected (the start-trigger path) it stays the
  pre-slice no-op.
- **`assemble.ts`** — `runInputTrigger(state)` (runs `runTrigger('input')` over the
  transcript *without* the new user message — excluded and re-added — adopting a
  rewrite only on a real change so trigger-less sends are unchanged; folds
  `varChanged`) and `applyEditInput(state)` (`runLuaEditTrigger('editinput')` →
  `expandVariables` CBS → `processScript('editinput')` over the appended user row).
  Wired into `assemblePrompt`; `captureSubmitTranscript` snapshots the post-hook
  transcript; `submitMessages` / `submitTranscriptChanged` ride on `AssembleResult`.
  New mutation sources `input_trigger` / `editinput`.
- **`generationChat.ts`** — `persistAssemblyChatVars` → `persistAssemblyMutations`:
  also writes the submit transcript (`messages.replaced` event) when
  `submitTranscriptChanged`, combined with the chat-var delta into one revision;
  returns the bumped revision on the `info` frame.
- **`DefaultChatScreen.svelte`** — `sendMain` skips `runTrigger('input')` +
  `processScript('editinput')` for the server path (`isFastifyServer &&
  useServerPromptAssembly`) and appends the raw user text; B1 (slash / file-inlay)
  unchanged.
- **Tests** — `generation.chat.test.ts`: input-trigger Lua (transcript rewrite +
  var write + revision), editinput Lua (message_patch + persisted + assembled
  prompt), regex editinput (persisted), and a plain-send no-op (no route message
  write). `serverPromptAssembly.test.ts`: input/editinput-Lua → `server`.
  `sendChat.fixtures.serverBacked.test.ts`: route-backed regex-editinput
  integration (raw sent, server transforms, projection + persisted reconcile).

## Why the Lua / golden proofs live in the server suite

`editinput`/input-trigger **Lua** parity can't run in the browser-suite
route-backed harness: wasmoon's WASM init throws under jsdom (same reason as the
editRequest proof). And even **regex** `editinput` can't be a "server == local
golden" check — the local golden sweep drives `sendChat` directly, bypassing the
chat-screen submit handler where the browser runs `editinput`, so the local golden
never carries an editinput transform. The server suite therefore owns the Lua/parity
proofs; the route-backed regex test proves the browser→route→projection integration.
