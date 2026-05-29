# Reference: Server Assembler Parity (A1, server side)

Date: 2026-05-29

Backs Phase 4 work-order item **3** (A1 content classes) and gives the parity
baseline for item **1**. The server `/api/v1/generate/chat` assembler must
produce the *same* prompt as the browser; this doc is the exact AT-PARITY-vs-GAP
map of the server `prompt/` code, plus the route contract. Pair it with
[`local-assembler-content-classes.md`](local-assembler-content-classes.md)
(the browser branches that must be ported or classified `unsupported`).

All paths are from the repo root under `server/fastify/src/`. Line anchors may
drift; symbol names are the stable handle.

## Parity matrix

| Capability | Status | Where |
| --- | --- | --- |
| Run-var expansion over chat messages | **AT PARITY** | `prompt/assemble.ts:577-594` (`applyCurrentChatRunVars`) |
| CBS / `{{...}}` variable expansion | **AT PARITY** | `prompt/variables.ts:65-101` (`expandVariables` → `risuChatParser`) |
| Regex scripts (`editprocess`) | **AT PARITY** | `prompt/scripts.ts:315-356` (`processScript`); applied `prompt/history.ts:292-300,452-457` |
| Prompt templates / format order / render | **AT PARITY** | `prompt/templates.ts` (`normalizeTemplate`, `buildFormatOrder`, `renderFinalPrompt`) |
| Token budget (preflight + finalize) | **AT PARITY** | `prompt/preflight.ts`, `prompt/budgetFinalize.ts`; wired `assemble.ts:691-699,1071-1086` |
| Lorebook activation + depth prompts | **AT PARITY** | `prompt/lorebook.ts`; wired `assemble.ts:670-707,823-825` |
| Start triggers (`'start'`) | **AT PARITY** | `prompt/triggers.ts:876-892` (`runStartTrigger`); wired `history.ts:470` |
| HypaV3 / prompt-memory selection | **AT PARITY** (server-owned) | `assemble.ts:870-916` |
| Assembly-time chat-var mutations | **AT PARITY + persisted (C-A1 done)** — emitted as a patch *and* persisted by the route | `assemble.ts:596-607` (`buildChatVarMutations`), emitted `generationChat.ts:281-283`, persisted `persistAssemblyChatVars` |
| Multimodal / inlay asset bytes | **AT PARITY** (slice 3a) — route binds a non-empty `AssetLookup`; inlay bytes ride the request `inlayAssets`, asset/icon bytes come from the store | `prompt/assetLookup.ts` (`buildAssetLookup`) + `generationChat.ts` (`resolveStoredAssetImage`); bound in `assemble.ts::beginAssembly`, passed at `assemble.ts:fillHistoryAndBias` |
| **Lua `editRequest`** | **GAP (port-pending, slice 3b)** — identity default; needs the server Lua VM | `templates.ts:683`; never supplied |
| **Lua `editprocess`** | **GAP (port-pending, slice 3b)** — regex only; Lua arm is a browser no-op so the port is near-identity | `scripts.ts:50-56` (deferred) |
| **pluginV2 `editRequest` / `editprocess` / replacers** | **PERMANENT `unsupported`** — no-port list; classifier hard-fails via `hasPluginV2EditSet`; protected by the `A4R-pluginv2` audit invariant | classifier `serverPromptAssembly.ts`; invariant `util/client-thinning-audit.ts` |
| **Output triggers (`'output'`)** | **GAP** — declared, never invoked | `triggers.ts:103`; no `runTrigger(…,'output',…)` exists |
| Assembly-time scriptstate persistence | **DONE (C-A1)** — route persists the delta via `applyJsonCommandMutation`, returns the bumped revision over SSE | `generationChat.ts` `persistAssemblyChatVars` |
| Final-message persistence | **GAP by design** — still command-backed; browser POSTs `generation-result` (B2) | `index.svelte.ts:351` → `persistGenerationResultCommand` |

The content rows that change prompt *bytes* are: (a) image/asset multimodal
content — **now ported (slice 3a)**, (b) image-gen instruction (slice 3c, still
GAP), (c) Lua `editRequest`/`editprocess` (slice 3b, port-pending GAP — pluginV2's
equivalents are *permanent* `unsupported`, not a gap to close), and
(d) `'output'` triggers (an A2 concern; see
[`post-generation-and-persistence.md`](post-generation-and-persistence.md)).
Everything else is at parity, so the supported text-send subset is already
correct server-side — which is why A1's foundation batch can make it mandatory.

**Slice 1 *classified* every content class `unsupported` (hard fail), not
silently mis-assembled; each later slice graduates one.** `resolveServerPromptAssembly`
(`src/ts/process/request/serverPromptAssembly.ts`) detects each class via its own
named predicate (multimodal/asset markers + `message[].multimodals`; `triggerlua`
triggers via `sendHasLuaContent`; non-empty pluginV2 edit sets via
`hasPluginV2EditSet`; `currentChar.inlayViewScreen`). **As of
slice 3a the multimodal/asset class routes `→ server`** for image-input models;
the only surviving `unsupported` multimodal sub-case is **class 2** (image/asset
content on a model *without* `LLMFlags.hasImageInput`, whose browser-only
`runImageEmbedding` caption has no server equivalent). The image-gen (3c) predicate
and the Lua arm (3b, port-pending) still route `→ unsupported`; **the pluginV2 arm
(3b) is a *permanent* `→ unsupported`** (no-port list), split into its own
predicate (slice 3b) so the Lua sub-classes can flip independently and guarded by
the `A4R-pluginv2` audit invariant.

## `prompt/assemble.ts` — the facade

Root entry `assemblePrompt(input, deps)` (`assemble.ts:1096-1143`) chains the
slice functions in order: `beginAssembly` → `prepareRegenerateTranscript` →
`appendUserMessageRow` → `applyCurrentChatRunVars` → `fillStaticSlots` →
`fillLorebookSlots` → `fillHistoryAndBias` → `fillMemoryAndPostHistory` →
`renderAndBudget`.

- **Input** `AssembleInput` (`assemble.ts:147-158`): `chatId`, `characterId`,
  optional `presetId`/`loadoutId`, `mode`, `regenerateMessageId`, `userMessage`,
  `resetMessages`, `expectedRevision`, `inlayAssets?: unknown[]`. **`assemble.ts`
  never reads `state.input.inlayAssets`** — it is accepted and dropped.
- **Dependency seam** `AssembleDeps` (`assemble.ts:129-134`): `loadDatabase()`,
  optional `loadMemoryDatabase()`, `loadPromptMemoryQueryVectors()`,
  `enqueuePromptMemoryFollowUpJob`.
- **Output** `AssembleResult` (`assemble.ts:226-245`): on success `prompt`
  (the `prompt` SSE payload), `formated`, `biases`, `inputTokens`,
  `outputTokens`, `mutations` (`AssembleMutationPayload`), `restoration`. On
  abort `{ stopSending, abortReason, mutations, restoration }`.

### `buildChatVarMutations` — the C-A1 hook

`buildChatVarMutations(state)` (`assemble.ts:596-607`) diffs the chat's
`scriptstate` snapshot taken in `beginAssembly` (`initialScriptstate`, `:429`)
against the current persisted chat's scriptstate, producing
`{ key, before, after }[]` (`AssembleChatVarMutation`, `:169-173`). It is folded
into `AssembleMutationPayload.chatVarMutations` by `buildMutationPayload`
(`assemble.ts:609-620`) and attached as `result.mutations` (`:1114,1140`). The
route then emits it as a `message_patch` (`generationChat.ts:281-283`):

```ts
if (result.mutations) { emit({ type: 'message_patch', patch: result.mutations }) }
```

So chat-var mutations are *computed* server-side during assembly, emitted as a
patch for the browser's projection, **and (C-A1, done) persisted by the route
itself** through `persistAssemblyChatVars` → `applyJsonCommandMutation` for
persisting modes; the route returns the bumped revision on the `info` frame and
the browser no longer replays the delta as a command. **Crucially, this delta
reflects the assembly-time `'start'` trigger + run-var pass only — it never
includes the post-gen `'output'` trigger** (which has no server path). C-A1
moved the persistence into the route; porting the output trigger is A2. They are
distinct — see [`post-generation-and-persistence.md`](post-generation-and-persistence.md).

## `prompt/history.ts` — the multimodal / asset seam (now fed, slice 3a)

The `AssetLookup` seam (`history.ts:109-116`) has three optional resolvers —
`getInlay(id)`, `getAsset(name)`, `getCharIcon()`. `processInlays`
(`history.ts:218-247`) strips `{{inlay…}}` tags and pushes `getInlay?.(id)`;
`processAssetPrompts` (`history.ts:249-269`) strips `{{asset_prompt::…}}` and
pushes `getAsset?`/`getCharIcon?`. These shapes were always correct — they were
just starved of data while `buildHistoryWindow` defaulted to the empty
`NO_ASSETS` (`history.ts:118`).

**Slice 3a feeds the seam.** `beginAssembly` builds a non-empty `AssetLookup`
(`prompt/assetLookup.ts::buildAssetLookup`) and stores it on
`state.assetLookup`; `fillHistoryAndBias` passes it as the 5th arg to
`buildHistoryWindow` instead of `NO_ASSETS`. The byte-source split:

- **Inlay bytes** (`{{inlay/inlayed/inlayeddata::id}}`) live only in the
  browser's localForage; `getInlay(id)` resolves them from the request
  `inlayAssets` payload (finally populated by `serverBackedSendChat.ts`).
- **Asset bytes** (`{{asset_prompt::name}}` + the `icon` fallback) live in the
  server assets store; `getAsset`/`getCharIcon` resolve a char/module asset
  reference (or `currentChar.image`) through the route's
  `resolveStoredAssetImage`, re-wrapped as a `data:image/png;base64,` URI
  (matching the browser's `readImage(asset[1])` path).

`NO_ASSETS` survives only as the fallback when no resolver is bound (prompt-leaf
tests).

## `prompt/templates.ts` — the Lua `editRequest` gap

The request-edit seam defaults to identity (`templates.ts:683`):

```ts
editRequest = (rows) => rows,
```

Type at `templates.ts:635`; applied at `:725-730` (over `formated`, and over
`promptInfo` when present). `renderAndBudget` calls `renderFinalPrompt` without an
`editRequest` key (`assemble.ts:1058-1068`), so the identity always applies. The
doc-comment (`templates.ts:629-633`) states the real one is deferred ("Browser
Lua execution stays deferred").

Server scripts are **regex-only**. `processScript` (`scripts.ts:315-356`) walks
`db.presetRegex` + `char.customscript` + active-module regex; it is the only
script transform, applied in the history walk (`history.ts:292-300,452-457`).
The `scripts.ts` header (`:50-56`) explicitly defers `runLuaEditTrigger` and
`pluginV2[mode]`. A faithful port needs the **Lua** hooks (a) inside the
`editprocess` history pass next to `processScript`, and (b) at the `editRequest`
seam (`templates.ts:726`). The **pluginV2** equivalents are *not* ported — they
are permanent `unsupported` (no-port list), and the `A4R-pluginv2` audit invariant
forbids reintroducing a server-side plugin execution path in this dir.

## `prompt/triggers.ts` — the trigger gap (A2)

`TriggerMode` declares six modes (`triggers.ts:99-107`):
`'start' | 'manual' | 'output' | 'input' | 'display' | 'request'`. But only
`'start'` and `'manual'` are ever *invoked*:

- `runStartTrigger` (`triggers.ts:876-892`) ends with
  `runTrigger(runCtx, char, 'start', { chat })`; its sole consumer is
  `buildHistoryWindow` (`history.ts:470`) — i.e. **assembly time**, not post-gen.
- the two recursion arms force `'manual'` (`triggers.ts:538,766`).

**No `runTrigger(…, 'output', …)` invocation exists anywhere on the server.**
`'output'` lives only in the type union. Output-trigger handling is the A2 gap;
the runner already accepts the `'output'` mode value and the `setvar`/`v2SetVar`
arms are durable via the `TriggerVarEngine` — what's missing is *calling* it on
the completion text post-generation.

## `routes/generationChat.ts` — the route (`/generate/chat`)

- **Request body** `ChatRequestBody` (`generationChat.ts:25-37`), all fields
  `unknown`, validated in `validate` (`:73-109`). `inlayAssets` is validated as
  "an array when provided" (`:105-107`) and mapped into the input at
  `toAssembleInput` (`:163`). **As of slice 3a it is read end to end**:
  `beginAssembly` parses it into the `AssetLookup`'s `getInlay` (the client now
  populates it in `serverBackedSendChat.ts`).
- **Calls the assembler** via `assemblePrompt(input, deps)` (`:265`), with
  `deps` from `loadDatabaseDeps(dataDir, db)` (`:264`) whose `loadDatabase` is
  `loadPersisted(dataDir).database` — a read-only file read.
- **Returns SSE** (`text/event-stream`, `:251-255`). Success frame order
  (`:258-295`): `stage(validate)` ×2 → `stage(prompt start)` → `prompt` →
  `message_patch` (if mutations) → `stage(prompt end)` → `info` → optional
  provider `token`/`side_effect`/`done`. **The `info` frame now carries the
  bumped `revision`** when the route persisted an assembly-time chat-var delta
  (C-A1); it is omitted otherwise. The one-shot JSON sibling
  `POST /api/v1/generate/preview-prompt` (`:402-425`) returns `result.prompt`
  as plain JSON (404 on `EntityNotFoundError`) and stays read-only.
- **Writes only the assembly-time scriptstate delta (C-A1).** It still imports
  `loadPersisted` read-only for assembly, but now also persists the chat-var
  delta through `persistAssemblyChatVars` → `applyJsonCommandMutation` (the same
  JSON-command machinery the scriptstate command uses: one revision bump, one
  `chat.scriptstate.updated` event, rollback on failure) for persisting modes
  only — preview / preview_prompt stay read-only. The assembler itself still
  operates on a `structuredClone` of the chat (`resolveScope`,
  `assemble.ts:393`); the persistence reloads the store inside the mutation
  transaction. No message/final-result persistence happens here — that stays
  command-backed (B2).
- **Binds the asset seam (slice 3a)** — `loadDatabaseDeps` supplies
  `resolveStoredAssetImage(reference)` (reads `data/assets/` via `assetById` /
  `assetPath`, re-wraps as a png data URI); `beginAssembly` folds it plus the
  request `inlayAssets` into `state.assetLookup`. `RouteAssembleDeps` still also
  carries `getDatabase()`.

C-A1 is pinned by `server/fastify/__tests__/generation.chat.test.ts` — a `setvar`
start trigger emits `chatVarMutations` in the patch **and** bootstrap afterwards
shows the bumped `revision: 2` with the written `scriptstate: { $score: '9' }`
(the flipped statelessness assertion), while `mode: 'preview'` stays
`revision: 1` / `scriptstate: undefined`, and a non-active-writer `/chat` 423s
before persisting.

## Full `prompt/` file map

| File | Role |
| --- | --- |
| `assemble.ts` | Assembly facade; `assemblePrompt` chains the slices, returns prompt payload + mutation/restoration patches. |
| `budgetFinalize.ts` | Final request-budget pass (`finalizeRequestBudget`): re-tokenize, trim removable rows, clamp response budget. |
| `cbsAdapter.ts` | Server-side `CBSRegisterArg` factory (DI for CBS callbacks; replaces SPA stores). |
| `chatDispatch.ts` | Provider dispatch for server generation (`dispatchChatProvider`, `getServerGenerationModelString`). |
| `assetLookup.ts` | Builds the per-send `AssetLookup` (slice 3a): `getInlay` from request `inlayAssets`, `getAsset`/`getCharIcon` from the store resolver. |
| `history.ts` | History-window builder; the `AssetLookup` seam (`getInlay`/`getAsset`/`getCharIcon`) it feeds inlay/asset bytes through. |
| `lorebook.ts` | Lorebook activation, decorators, `buildLorebookContext`, depth prompts. |
| `memory.ts` | Non-Hypa memory window (`buildMemoryWindow`). |
| `memoryAdapter.ts` | Prompt-memory selection adapter (HypaV3 retrieval). |
| `memoryFollowups.ts` | Enqueues follow-up memory jobs. |
| `modules.ts` | Active-module resolution + extractors (regex/triggers/assets). |
| `plainSections.ts` | `main`/`jailbreak`/`globalNote` blocks (`buildPlainPromptSections`). |
| `preflight.ts` | Template-wide token preflight. |
| `promptScope.ts` | Module-level singleton holding active DB/char/chat; scriptstate dirty flag. |
| `promptVariablesBoot.ts` | One-time CBS/variable parser boot. |
| `providerTransport.ts` | Maps provider frames to SSE `token`/`done`/`side_effect`. |
| `scripts.ts` | Regex-script processor (`processScript`); Lua/pluginV2 deferred. |
| `sseEvents.ts` | SSE event taxonomy + `writePromptChatEvent` (defines `message_patch`, etc.). |
| `staticSections.ts` | `buildDescription`/`buildPersona`/`buildAuthorNote`/`buildCotInstruction`. |
| `tokenizerConfig.ts` | Shared tokenizer config from `db.aiModel`. |
| `tokens.ts` | Minimal server tokenizer. |
| `triggerDataEffects.ts` | V2 trigger "safe data helper" leaf arms. |
| `triggerVars.ts` | Trigger variable engine (`getVar`/`setVar`, chat-var persistence into the snapshot). |
| `triggers.ts` | Trigger model + runner; only `'start'`/`'manual'` invoked. |
| `templates.ts` | Template normalize + render; home of the identity `editRequest` gap. |
| `variables.ts` | Server `risuChatParser` entry (`expandVariables`). |
