# Sub-slice 3b-4: Input-trigger / `editinput` at submit

Date: 2026-05-29 (handover; not started)

| | |
| --- | --- |
| **Series** | [Lua server port](README.md), sub-slice **4 of 4** |
| **Depends on** | **sub-slice 1** (the VM) |
| **Goal** | Add a **submit-time** server hook (before assembly) that runs the input trigger + `editinput` scripts, which rewrite the transcript before the user message is persisted. The structurally hardest sub-slice (it needs a *new* seam). |

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
assembly. `/generate/chat` is currently stateless re the chat blob, so this needs a
pre-assembly server hook.

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

- [ ] A submit-time server hook runs `runTrigger('input')` + `editinput` before
      assembly, at parity with the browser.
- [ ] The persisted transcript reflects the post-`editinput` rewrite.
- [ ] The B1 input-plumbing branches remain browser-owned (unchanged).
- [ ] Classifier routes editinput Lua → `server`; interactive-API Lua → `unsupported`.
