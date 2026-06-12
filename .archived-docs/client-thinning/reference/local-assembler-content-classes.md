# Reference: Local Assembler Content Classes (A1, browser side)

Date: 2026-05-30

Backs Phase 4 work-order item **3** (A1 content classes). These are the
historical content branches in the *browser's* local prompt assembly and their
current dispositions: ported server-side or explicitly server-`unsupported`.
Assembly is all-or-nothing per send, so an unsupported class hard-fails instead
of silently falling back to local assembly.

Entry: `sendChat` (`src/ts/process/index.svelte.ts:54`) →
`assembleLocalSendChatPrompt` (`src/ts/process/sendChatPromptAssembly.ts:62`) →
fans into `src/ts/process/promptAssembly/*`. Line anchors may drift; symbols are
the stable handle.

## Summary

| # | Class | Key location | Mutates | Disposition |
| --- | --- | --- | --- | --- |
| 1 | Multimodal / asset inlining | `promptAssembly/formatHistoryMessage.ts:73-193` | prompt rows (`multimodals`+content) | A1 — **ported (slice 3a)**: server binds `AssetLookup`; image-input models → `server` |
| 2 | Non-vision image-caption fallback | `transformers.ts:111`; call `formatHistoryMessage.ts:111-114` | prompt row content | A1 — **`unsupported` (slice 3a class 2)**: browser-only ML, no server path |
| 3 | Image-gen instruction | `promptAssembly/buildStaticPromptSections.ts:47`; call `sendChatPromptAssembly.ts:114` | prompt rows (`postEverything`) | A1 — **ported (slice 3c)**: server appends the `newGenData`/`viewScreen` system row; char with `inlayViewScreen` → `server` |
| 4 | Lua `editRequest` | `promptAssembly/renderFinalPrompt.ts:384`; engine `scriptings.ts:1415,1117-1126` | request rows | A1 — **ported (slice 3b sub-slice 2)** for non-interactive Lua |
| 5 | Lua + pluginV2 `editprocess` | `formatHistoryMessage.ts:44-52`; pluginV2 `scripts.ts:151-158` | prompt row content | A1 — Lua **ported** as browser no-op parity (slice 3b sub-slice 3); pluginV2 **permanent unsupported** |
| 6 | Input-trigger / `editinput` at submit | `DefaultChatScreen.svelte:232,240` | chat transcript | A1 — **ported (slice 3b sub-slice 4)** for non-interactive Lua/regex; interactive Lua dialogs unsupported |
| 7 | Script pipeline (machinery) | `scripts.ts:121` (`processScriptFull`) | text/rows | A1 — the runtime classes 4-6 share |
| 8 | Group-ness / character selection | `index.svelte.ts:54`; filter `database.svelte.ts:110` | control flow | subset gate (single non-group char) |

Two B1 (browser-owned, *not* A1) input-handling branches are called out under
class 6 so they are not conflated with the script parts.

## 1. Multimodal / asset inlining

All inlining is in the per-message converter `formatHistoryMessage`
(`promptAssembly/formatHistoryMessage.ts`), invoked from the history window
(`promptAssembly/buildHistoryWindow.ts:142`).

- **Inlay marker extraction** (char vs user roles differ): `formatHistoryMessage.ts:73-91`.
- **Asset → bytes resolver #1 (inlays):** `getInlayAsset(inlayName)`
  (`formatHistoryMessage.ts:102`), backed by the localForage `inlayStorage`
  (`src/ts/process/files/inlays.ts:163`), returns `{ ...img, data }` with `data`
  already base64/data-URI (`blobToBase64`, `inlays.ts:171`).
- **Has-vision branch** pushes an inline image part (`formatHistoryMessage.ts:104-110`);
  video/audio/signature parts follow (`:116-129`).
- **Asset → bytes resolver #2 (`{{asset_prompt::…}}` / `{{assetprompt::…}}`):**
  `formatHistoryMessage.ts:154-180`. Asset list = `currentChar.additionalAssets`
  + `getModuleAssets()` (`src/ts/process/modules.ts:454`); bytes via
  `readImage(asset[1])` (`src/ts/globalApi.svelte.ts:196`), encoded to a data
  URI. The `icon` special case reads `currentChar.image` (`:168-178`).
- The assembled `OpenAIChat.multimodals` (type at `index.svelte.ts:35-40`) is
  attached at `formatHistoryMessage.ts:183-193`.

**Needs:** localForage `inlayStorage` (IndexedDB), `additionalAssets`, module
assets, `currentChar.image`, `readImage`/`blobToBase64`, and
`getModelInfo(DBState.db.aiModel).flags` (`:94`) to pick vision vs caption.
**Server port (done, slice 3a):** `beginAssembly` builds a non-empty
`AssetLookup` (`prompt/assetLookup.ts`) from the request `inlayAssets` + the
store resolver (see [`server-assembler-parity.md`](server-assembler-parity.md)
§`history.ts`). The client now *populates* `inlayAssets`:
`serverBackedSendChat.ts::collectServerInlayAssets` resolves each inlay id via
the same `getInlayAsset` path and ships the bytes (the server has no copy of
localForage). Asset/icon bytes come from the server store, so the client need
not send those. **Vision split:** image-input models route `server`; class 2
below (no `LLMFlags.hasImageInput`) routes `unsupported`.

## 2. Non-vision image-caption fallback — `runImageEmbedding`

Definition `transformers.ts:111` (`runImageEmbedding(dataurl)`): runs the
`@huggingface/transformers` `image-to-text` pipeline
(`Xenova/vit-gpt2-image-captioning`) **in the browser** (`initTransformers`,
`transformers.ts:16`; model fetched from `https://sv.risuai.xyz/transformers/`).
Invoked in the else-branch when the model lacks `LLMFlags.hasImageInput`
(`formatHistoryMessage.ts:111-114`), appending `[<caption>]` to the message body.

**Needs:** a browser WASM/WebGPU ML pipeline. No server equivalent exists.
**Disposition (slice 3a):** `unsupported`. `resolveServerPromptAssembly` routes
any image/asset/inlay content on a model without `LLMFlags.hasImageInput` to
`unsupported` (hard fail) rather than emit a silently captionless prompt. The
captionless-difference alternative was rejected. See
[`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md).

## 3. Image-gen instruction — `buildInlayViewInstruction` / `newGenData`

`buildInlayViewInstruction(currentChar)` (`promptAssembly/buildStaticPromptSections.ts:47`),
called at `sendChatPromptAssembly.ts:114` (`unformated.postEverything.push(...)`).
`newGenData` is a **field on `character`** (read, not a function) supplying two
instruction strings:

- `viewScreen === 'emotion'` → `newGenData.emotionInstructions` with `{{slot}}`
  replaced by the comma-joined `emotionImages` names.
- `viewScreen === 'imggen'` → `newGenData.instructions`.

Gated by `currentChar.inlayViewScreen`. **Needs:** static character fields only
(`inlayViewScreen`, `viewScreen`, `newGenData.*`, `emotionImages`).
**Mutates:** adds a `system` row to the prompt.

**Server port (done, slice 3c):** `prompt/staticSections.ts::buildInlayViewInstruction`
reproduces the logic byte-for-byte (no variable expansion — the SPA builder does
not run `risuChatParser`, only the manual `{{slot}}` → `emotionImages` swap), and
`assemble.ts::fillStaticSlots` appends it to `postEverything` after the
chain-of-thought row, mirroring the SPA push at `sendChatPromptAssembly.ts:114`.
The character config is already on the server's loaded `Database`, so no new
request field is needed. `resolveServerPromptAssembly` routes a char with
`inlayViewScreen` set to `server`. **The actual image generation / inlay-screen
rendering stays a post-gen browser effect** (`src/ts/process/inlayScreen.ts`,
`runStage4.ts`, B1) — only the instruction text moved.

## 4. Lua `editRequest`

The browser runs the Lua/Python `editRequest` hook over the fully-assembled
request rows at the end of `renderFinalPrompt`
(`promptAssembly/renderFinalPrompt.ts:384`):

```ts
formated = await runLuaEditTrigger(currentChar, 'editRequest', formated)
```

and again over the prompt-info capture array (`:388-392`). `renderFinalPrompt` is
called at `sendChatPromptAssembly.ts:212`.

**Engine:** `runLuaEditTrigger` (`src/ts/process/scriptings.ts:1415`) iterates the
character's `triggerscript` (+ `getModuleTriggers()`) and, for
`effect[0].type === 'triggerlua'`, calls `runScripted`. For
`mode === 'editRequest'` it invokes the Lua global `callListenMain`
(`scriptings.ts:1117-1126`); handlers are registered via
`listenEdit('editRequest', fn)` (`:1316-1320`) and folded by `callListenMain`
(`:1380-1409`). The Pyodide path mirrors at `:1163-1172`. The VM is `wasmoon`'s
`LuaFactory`/`LuaEngine` (`makeLuaFactory`, `:1191`).

**Server port (done, slice 3b sub-slice 2):** the server `wasmoon` VM runs
non-interactive Lua `editRequest` through `assemble.ts::buildLuaEditRequest`;
scripts using interactive dialog APIs stay `unsupported`. Pyodide is not ported.

> **Two-stage request edits.** Beyond assembly-time `editRequest`, the *dispatch*
> layer (`src/ts/process/request/request.ts`) also edits request rows:
> pluginV2 `replacerbeforeRequest` (`request.ts:268-272`), the `'request'`
> trigger whose JSON replaces `arg.formated` (`:278-290`), and pluginV2
> `replacerafterRequest` over the *result* post-gen (`:316-320`). A server
> reproducing assembly must account for both stages.

## 5. Lua + pluginV2 `editprocess` script hooks

`editprocess` runs per history message via `processScriptFull(nowChatroom, …,
'editprocess', index, …)` (`promptAssembly/formatHistoryMessage.ts:44-52`) and
over the first/greeting message (`promptAssembly/buildHistoryWindow.ts:114-118`).
Inside the pipeline:

- **Lua `editprocess` is a no-op** — `runLuaEditTrigger` early-returns for this
  mode (`scriptings.ts:1431-1432`).
- **pluginV2 `editprocess` runs** (`scripts.ts:151-158`), iterating the
  `pluginV2.editprocess` set (`src/ts/plugins/plugins.svelte.ts:551`).

Script-type constants: `ScriptMode = 'editinput'|'editoutput'|'editprocess'|'editdisplay'`
(`scripts.ts:29`); Lua hook names `editRequest|editDisplay|editInput|editOutput`
(`scriptings.ts:1117-1120`); trigger modes (`triggers.ts:47`); pluginV2 registry
(`plugins.svelte.ts:540-557`). **Needs:** registered JS `EditFunction`s from V2
plugins (browser plugin runtime). **Mutates:** per-message prompt content.

**Disposition (slice 3b).** The two arms split: **Lua `editprocess`** is a
browser no-op (`scriptings.ts:1431-1432` early-returns), and the server now routes
it through the VM-backed history seam at parity. **pluginV2 `editprocess`** (and
the other pluginV2 edit/replacer hooks) is **permanent `unsupported`** —
server-side plugin code execution is on the no-port list and pluginV2 is
superseded by Plugin V3. The classifier reports the two via separate predicates
(`luaUsesInteractiveApi` vs `hasPluginV2EditSet`) so non-interactive Lua routes
`server` while pluginV2 remains a permanent hard fail. The `A4R-pluginv2` audit
invariant (`util/client-thinning-audit.ts`) forbids a server-side plugin
execution path.

## 6. Input-trigger / `editinput` scripts at submit

In the chat-screen submit handler (`src/lib/ChatScreens/DefaultChatScreen.svelte:229-244`):

- **Input trigger** `runTrigger(char, 'input', { chat })` (`:232`) — can rewrite
  the whole transcript (`cha = triggerResult.chat.message`).
- **`editinput` script** `processScript(char, messageInput, 'editinput')` (`:240`)
  — for `'editinput'`, Lua *does* fire (mapped to `'editInput'`,
  `scriptings.ts:1422-1423`), plus pluginV2 `editinput` and regex scripts.

These mutate the chat transcript *before* the message is appended/persisted and
before assembly begins. **Server port (done, slice 3b sub-slice 4):**
`assemble.ts::runInputTrigger` and `applyEditInput` run this path server-side;
`generationChat.ts::persistAssemblyMutations` owns the changed transcript write.

**Not A1 — B1 (browser-owned input plumbing), same handler, earlier:**
- Slash-command text (`DefaultChatScreen.svelte:203-209`) → `processMultiCommand`.
- File-inlay insertion (`:211-216`) → appends `{{inlayed::<id>}}` markers (bytes
  resolved later by class 1).

## 7. The script pipeline (shared machinery)

Central function `processScriptFull(char, data, mode, chatID, cbsConditions)`
(`src/ts/process/scripts.ts:121`; thin wrapper `processScript` at `:37`).
Dispatch order in one call:

1. Lua/Python edit hook — `runLuaEditTrigger` (`scripts.ts:130`).
2. `editdisplay` display-trigger — `runTrigger('display', …)` (`:132-149`, only
   for `editdisplay`).
3. pluginV2 hooks — `pluginV2[mode]` (`:151-158`).
4. CBS / curly parser — `risuChatParser` (`:160`).
5. Regex scripts — preset + `char.customscript` + module regex with the
   `@@emo`/`@@inject`/`@@move_*`/`@@repeat_back` action grammar (`:161-331`).
6. Dynamic-asset similarity matching — `HypaProcesser` (`:379-423`; skipped for
   `editinput`/`editprocess`).

This is the machinery classes 4-6 need server-side: the CBS parser, regex engine,
and non-interactive Lua VM are now at parity. Pyodide and pluginV2 sets are not
ported; pluginV2 remains permanent `unsupported`.

## 8. Group-ness & character selection

- `chatProcessIndex` (`index.svelte.ts:54`) is the **autopilot/reentrancy slot**,
  not a group index (entry guard `:107-129`; autopilot fanout
  `src/lib/SideBars/DevTool.svelte:260`; `multisend` uses `sendChat(-1)`).
- **Groups are filtered out of the database entirely** at `database.svelte.ts:110`
  (`data.characters = data.characters.filter(c => c?.type !== 'group')`), so a
  group chatroom cannot reach `sendChat` in this Fastify variant.
- `isGroupChat` is hardcoded `false` (`src/ts/process/dispatch/dispatchRequest.ts:106`;
  type `request.ts:50`); group behavior was driven by recursion + `selectedCharID`,
  not this flag.
- Active responder: `selectedChar = get(selectedCharID)` →
  `nowChatroom = DBState.db.characters[selectedChar]` (`src/ts/process/sendChatContext.ts:76,142`);
  per-message speaker via `findCharacterbyIdwithCache(msg.saying)`
  (`formatHistoryMessage.ts:60-61`).

**For the A1 classifier:** even though groups are filtered upstream, the flag's
JSDoc still lists "group chat" as a non-parity item — treat group-ness as an
explicit `unsupported` signal rather than relying on the filter. Group chat is
**legacy** and slated for client removal (a separate task); do not add a server
group model. See [`../unsupported-and-client-owned.md`](../unsupported-and-client-owned.md).
