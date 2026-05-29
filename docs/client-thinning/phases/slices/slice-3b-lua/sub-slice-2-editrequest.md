# Sub-slice 3b-2: Lua `editRequest` hook + classifier flip

Date: 2026-05-29 (handover; not started)

| | |
| --- | --- |
| **Series** | [Lua server port](README.md), sub-slice **2 of 4** |
| **Depends on** | **sub-slice 1** (the VM) |
| **Goal** | Wire the VM-backed Lua `editRequest` hook into the assembler's request-edit seam and flip the classifier's Lua arm to `server` for the editRequest case. The dominant Lua case. |

## The seam already exists (unused)

`renderFinalPrompt` already accepts an injectable `editRequest`
(`templates.ts:635`, applied `:725-730` over `formated` and the `promptInfo`
capture). It defaults to identity and is **never supplied**: `renderAndBudget`
calls `renderFinalPrompt` without the key at **`assemble.ts:1082`**. The browser
runs it at `renderFinalPrompt.ts:384` via `runLuaEditTrigger(char,'editRequest',formated)`.

## Step-by-step

1. In `renderAndBudget` (`assemble.ts:1082`), supply
   `editRequest: (rows) => runLuaEditTrigger(char, 'editRequest', rows, ctx)` from the
   sub-slice-1 runtime, threading the assembly's char + var-engine context. Apply it
   over `formated` **and** the `promptInfo` capture (the browser does both).
2. Ensure Lua `setChatVar`/`setState` writes during the hook land in the scriptstate
   delta (`buildChatVarMutations` / `persistAssemblyChatVars`) — see
   [README §Integration](README.md#integration-points-in-the-server-assembler). Add a
   test that an `editRequest` that calls `setState` bumps the persisted revision.
3. **Flip the classifier.** The Lua arm (`sendHasLuaContent`,
   `serverPromptAssembly.ts`) cannot tell statically which mode a script hooks
   (handlers register at runtime). Decide the flip granularity:
   - simplest defensible cut: flip the Lua arm to `server` **except** when the Lua
     source references an interactive API (`alertInput`/`alertSelect`/`alertConfirm`)
     → keep those `unsupported` (the finer arm). Add a `luaUsesInteractiveApi(char)`
     predicate.
   - update `request/tests/serverPromptAssembly.test.ts`: a `triggerlua` char now
     routes `server`; an interactive-API char stays `unsupported`.
4. Replace the server `triggerlua` no-op fall-through if it interferes
   (`triggers.ts:264-280,817-834`) — but `editRequest` runs via the template seam,
   not `runTrigger`, so this may be untouched here. Confirm.

## Prove

- `generation.chat.test.ts`: a char whose Lua `editRequest` appends/rewrites a row →
  the server-assembled prompt reflects it (vs regex-only baseline).
- `sendChat.fixtures.serverBacked.test.ts` Describe B: server == local golden for a
  `triggerscript` editRequest char.
- Classifier: `triggerlua` → `server`; interactive-API Lua → `unsupported`.
- Shared verification.

## When done

- [ ] Server runs the Lua `editRequest` hook at byte parity with the browser.
- [ ] Classifier routes editRequest Lua → `server`; interactive-API Lua → `unsupported`.
- [ ] Lua var writes during the hook persist via the scriptstate delta.
- [ ] Parity fixture green.
