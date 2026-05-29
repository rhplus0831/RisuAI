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
| Chat-var mutations surfaced as patch | **AT PARITY** (as a *patch*, not persisted) | `assemble.ts:596-607` (`buildChatVarMutations`), emitted `generationChat.ts:281-283` |
| **Multimodal / inlay asset bytes** | **GAP** — bound to `NO_ASSETS` | `history.ts:118` + `assemble.ts:736` |
| **Lua / pluginV2 `editRequest`** | **GAP** — identity default | `templates.ts:683`; never supplied |
| **Lua / pluginV2 `editprocess` hooks** | **GAP** — regex only | `scripts.ts:50-56` (deferred) |
| **Output triggers (`'output'`)** | **GAP** — declared, never invoked | `triggers.ts:103`; no `runTrigger(…,'output',…)` exists |
| Chat-blob persistence (messages/scriptstate) | **GAP by design** — stateless; emits patch, browser replays | route imports only `loadPersisted` (read-only) |

The content rows that change prompt *bytes* are: (a) image/asset multimodal
content, (b) Lua/pluginV2 `editRequest`/`editprocess`, and (c) `'output'`
triggers (an A2 concern; see [`post-generation-and-persistence.md`](post-generation-and-persistence.md)).
Everything else is at parity, so the supported text-send subset is already
correct server-side — which is why A1's foundation batch can make it mandatory.

**As of slice 1, the three A1 GAP rows are *classified* `unsupported`, not
silently mis-assembled.** `resolveServerPromptAssembly`
(`src/ts/process/request/serverPromptAssembly.ts`) detects each content class via
its own named predicate (multimodal/asset markers + `message[].multimodals`;
`triggerlua` triggers + non-empty pluginV2 edit sets; `currentChar.inlayViewScreen`)
and routes any send carrying one to `unsupported` (hard fail) instead of letting
the server drop its bytes/instructions. Each later content slice (3a/3b/3c) ports
one row to parity and flips its detector to `→ server`.

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

So chat-var mutations are *computed* server-side during assembly but *surfaced as
a patch for the browser to replay*, never persisted by this route. **Crucially,
this delta reflects the assembly-time `'start'` trigger + run-var pass only — it
never includes the post-gen `'output'` trigger** (which has no server path).
Moving the persistence into the route is the C-A1 batch; porting the output
trigger is A2. They are distinct — see
[`post-generation-and-persistence.md`](post-generation-and-persistence.md).

## `prompt/history.ts` — the multimodal / asset gap

`NO_ASSETS` (`history.ts:118`) is an empty `AssetLookup`:

```ts
export const NO_ASSETS: AssetLookup = {}
```

It is the default `assetLookup` param of `buildHistoryWindow` (`history.ts:392`).
The `AssetLookup` seam (`history.ts:109-116`) has three optional resolvers —
`getInlay(id)`, `getAsset(name)`, `getCharIcon()` — designed so the route layer
*could* resolve inlay ids / asset names to `MultiModal` bytes from the request
`inlayAssets` + the assets store. Because every method is undefined under
`NO_ASSETS`:

- `processInlays` (`history.ts:218-247`) strips `{{inlay…}}` tags but
  `lookup.getInlay?.(id)` returns `undefined`, pushing nothing to `multimodals`.
- `processAssetPrompts` (`history.ts:249-269`) strips `{{asset_prompt::…}}` but
  `lookup.getAsset?`/`getCharIcon?` return `undefined`.

Net: **image/asset prompts lose their bytes.** The only caller passes `NO_ASSETS`
hardcoded (`assemble.ts:731-738`), and a repo-wide search finds no construction
of a non-empty `AssetLookup` anywhere — `generationChat.ts` never builds or binds
one. Porting class 1 (multimodal inlining) means populating an `AssetLookup` from
`inlayAssets` + the assets store and passing it as the 5th arg to
`buildHistoryWindow`.

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
`pluginV2[mode]`. A faithful port needs Lua/pluginV2 hooks (a) inside the
`editprocess` history pass next to `processScript`, and (b) at the `editRequest`
seam (`templates.ts:726`).

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
  `toAssembleInput` (`:163`) — then dropped by the assembler (see above). So
  **`inlayAssets` is accepted but unused** end to end.
- **Calls the assembler** via `assemblePrompt(input, deps)` (`:265`), with
  `deps` from `loadDatabaseDeps(dataDir, db)` (`:264`) whose `loadDatabase` is
  `loadPersisted(dataDir).database` — a read-only file read.
- **Returns SSE** (`text/event-stream`, `:251-255`). Success frame order
  (`:258-295`): `stage(validate)` ×2 → `stage(prompt start)` → `prompt` →
  `message_patch` (if mutations) → `stage(prompt end)` → `info` → optional
  provider `token`/`side_effect`/`done`. **No revision is returned.** The
  one-shot JSON sibling `POST /api/v1/generate/preview-prompt` (`:402-425`)
  returns `result.prompt` as plain JSON (404 on `EntityNotFoundError`).
- **Stateless w.r.t. the chat blob — confirmed.** Its only repository import is
  read-only (`import { EntityNotFoundError, loadPersisted } from '../repository.js'`,
  `:8`); no `applyImport`/`writePersisted`/`bumpRevision`/`fs.` writes exist in
  the file. The assembler operates on a `structuredClone` of the chat
  (`resolveScope`, `assemble.ts:393`), so even in-memory edits never touch the
  store. The route's doc-comment (`:236-238`) states chat-var writes are
  persisted by the scriptstate command after the browser replays the patch.
- **Does not bind the asset seam** — no `AssetLookup`/`getInlay`/`getAsset`/
  `NO_ASSETS` reference; `RouteAssembleDeps` (`:174-176`) adds only `getDatabase()`.

The statelessness is pinned by `server/fastify/__tests__/generation.chat.test.ts:436-474`
(a `setvar` start trigger emits `chatVarMutations` in the patch, yet bootstrap
afterwards shows `revision: 1` and `scriptstate: undefined`) — this is the exact
assertion the C-A1 batch flips.

## Full `prompt/` file map

| File | Role |
| --- | --- |
| `assemble.ts` | Assembly facade; `assemblePrompt` chains the slices, returns prompt payload + mutation/restoration patches. |
| `budgetFinalize.ts` | Final request-budget pass (`finalizeRequestBudget`): re-tokenize, trim removable rows, clamp response budget. |
| `cbsAdapter.ts` | Server-side `CBSRegisterArg` factory (DI for CBS callbacks; replaces SPA stores). |
| `chatDispatch.ts` | Provider dispatch for server generation (`dispatchChatProvider`, `getServerGenerationModelString`). |
| `history.ts` | History-window builder; home of the `AssetLookup`/`NO_ASSETS` gap. |
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
