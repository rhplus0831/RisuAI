# HANDOVER

Date: 2026-05-24
Branch: `fastify`
Head: `807f5d1a feat: emit /chat SSE info telemetry (Phase 7-11i)`
Latest feature slice: `807f5d1a feat: emit /chat SSE info telemetry (Phase 7-11i)`

This is the day-to-day runbook for **Phase 7 in progress**:
current branch head, verification baselines, and the next pickup.
Phases 0-6 are closed. The strategic roadmap lives in
[`ROADMAP.md`](ROADMAP.md), and the detailed phase doc lives in
[`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md);
keep long planning there and keep this file focused on handoff state.

## Current State

Landed Phase 7 slices:

| Slice   | Commit     | Summary                                                                                                                                                                                                                                                                         |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1     | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine prompt SSE event names, and added prompt module shells.                                                                                                                                                     |
| 7-2a    | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                                                                                                                                                                                 |
| 7-2b    | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                                                                                                                                                                                   |
| 7-2c    | `7ed156e6` | Wired the server parser adapter: `promptScope.ts`, `cbsAdapter.ts`, `promptVariablesBoot.ts`, and real `expandVariables`.                                                                                                                                                       |
| 7-3     | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                                                                                                                                                                         |
| 7-4     | `051a5dcd` | Ported plain prompt sections: main, jailbreak, and global note.                                                                                                                                                                                                                 |
| docs    | `e7a76f32` | Organized the remaining Phase 7 roadmap into tiers.                                                                                                                                                                                                                             |
| 7-5a    | `c44e53fc` | Ported the minimal history walk: examples, start-new-chat marker, first message, makeMs filter, per-message role mapping.                                                                                                                                                       |
| 7-6a    | `9a60380d` | Ported the minimal regex script processor: preset+character regex chain, mode filter, flag sanitization, CBS in replacement.                                                                                                                                                    |
| 7-5b    | `7ad226b9` | Added per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill on the history walk.                                                                                                                                                                |
| 7-6b    | `8414d5c7` | Added scripts `@@`-action prefixes: `@@emo` (no-op), `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`.                                                                                                                                                                |
| 7-6c    | `5aae492b` | Added `ableFlag <order, actions>` DSL, `cbs`/`no_end_nl` actions, outScript prep, and SPA-parity flag defaults.                                                                                                                                                                 |
| 7-6d    | `cb5675d8` | Wired module regex scripts into the script chain via new `getActiveModules` + `getModuleRegexScripts` helpers.                                                                                                                                                                  |
| 7-5c    | `50a1770b` | Added history multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module asset triples.                                                                                                                                                                                 |
| 7-7a    | `c815e067` | Ported lorebook constant (always-on) entries with the in-scope decorator scaffold and `inject_lore` rewrites.                                                                                                                                                                   |
| 7-7b    | `25388d7d` | Added lorebook keyword matching: `searchMatch` port, child mirror, conditional-activation decorators, and `matchLog`.                                                                                                                                                           |
| 7-7c    | `b11902ad` | Added lorebook recursive activation: `while (matching)` loop, `recursivePrompt` accumulation, three recursion decorators.                                                                                                                                                       |
| 7-7e    | `c0f3fb3a` | Added lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.                                                                                                                                                             |
| 7-8a    | `17fca64f` | Minimal server tokenizer: `encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats` over `cl100k_base` / `o200k_base`.                                                                                                                                                    |
| 7-7d    | `f0382df8` | Lorebook budget-aware truncation: per-entry `tokens`, priority-desc filter, `loreSettings.tokenBudget` resolution.                                                                                                                                                              |
| 7-5e    | `febe67ce` | History `addedTokens` accumulator + depth-prompt token preflight when a `LorebookActivationReport` is supplied.                                                                                                                                                                 |
| 7-8b    | `d488ab7f` | Template-wide token preflight: `preflightTemplateTokens` walks the card list, returning `{ addedTokens, memoryCardUsed, hasCachePoint }`.                                                                                                                                       |
| 7-8c    | `c83015b3` | Request budget finalization: `finalizeRequestBudget` trims `removable` rows under `maxContextTokens` and clamps `outputTokens`.                                                                                                                                                 |
| 7-9a    | `cddc035e` | Trigger model + runner shell: `getModuleTriggers`, `collectTriggers`, `matchesTrigger`, and the `runTrigger` shell (no effect execution).                                                                                                                                       |
| 7-9b    | `cb23202b` | Trigger variables + conditions: `createTriggerVarEngine`, `evaluateConditions`, context/result extension, `parseKeyValue` lift.                                                                                                                                                 |
| 7-9c    | `cae61155` | Deterministic V1 effects: `setvar`, `systemprompt`, `impersonate`, `stop`, `cutchat`, `modifychat`, bounded `runtrigger` recursion.                                                                                                                                             |
| 7-9d-i  | `1bd8313b` | V2 control-flow core: index-based loop, `v2If`/`v2Else`/`v2EndIndent`/loops/`v2BreakLoop`, `v2SetVar`, `v2RunTrigger`, V2 state effects.                                                                                                                                        |
| 7-9d-ii | `faec5145` | V2 safe data helpers in `triggerDataEffects.ts`: message readers, string/array/dict/math, random, tokenize, regex, quick search.                                                                                                                                                |
| 7-9e    | `51155665` | Request/display state adapters: `display`/`request` effect allowlists + `v2GetDisplayState`/`v2SetDisplayState` + the five request-state arms.                                                                                                                                  |
| 7-9f    | `5291a0b0` | Start-trigger handoff (`runStartTrigger`) wired into async `buildHistoryWindow`: chat mutation, token contribution, `stopSending`, `varChanged`. Closes 7-5d.                                                                                                                   |
| 7-10a   | `765886be` | Template renderer foundation in `templates.ts`: `normalizeTemplate`, `buildFormatOrder`, `coalesceRows`, `renderByFormatOrder`, and the canonical `UnformatedPromptSlots` contract.                                                                                             |
| 7-10b   | `978ade30` | Content cards: shared `renderContentCard` (persona/description/authornote/lorebook/postEverything/plain/jailbreak/cot/chatML) + `renderByTemplate`; `preflight.ts` now consumes the same builder.                                                                               |
| 7-10c   | `0d2e0e17` | Chat cards + systemized chat: `chat` range math + `systemizeChat` lifted into `renderContentCard`; `preflight.ts`'s `chat` case removed (only `memory`/`cache` inline).                                                                                                         |
| 7-10d   | `3983d2d0` | Memory cards + cache markers: `memory` (clone + `innerFormat` wrap, no positionParser), explicit `cache` walk-back, and the automatic 3-deep `user` cache point — all in `renderByTemplate`.                                                                                    |
| 7-10e   | `2871960f` | Prompt-info capture + content trim: `renderByTemplate` returns `{ formated, promptInfo }`, collects the parallel info array via a `deps.promptInfo` sink, and trims both arrays (+ `renderByFormatOrder`).                                                                      |
| 7-10f   | `49df7eff` | Top-level `renderFinalPrompt`: `isContinue` pre-push, template/non-template dispatch, `depth_prompt` splice, and the injectable `editRequest` seam → `{ formated, promptText }`. Closes the renderer.                                                                           |
| 7-11a   | `e0902944` | `assemble.ts` state/context loader: `AssembleDeps` load seam, `beginAssembly` scope resolution (id→index, `EntityNotFoundError`), `createEmptyUnformatedSlots`, `ExpandContext`, `normalizeTemplate` + `buildFormatOrder`.                                                      |
| 7-11b   | `d08ca586` | `assemble.ts` static/plain slot fill: `fillStaticSlots` wires plain sections (non-utility/non-template) + author note / cot / description / persona into `state.unformated`.                                                                                                    |
| 7-11c   | `34e820d9` | `assemble.ts` lorebook placement + preflight: `buildLorebookContext` (slot distribution + `positionParser` + `depthPrompts`) + `fillLorebookSlots` (activate → distribute → `preflightTemplateTokens` → `currentTokens`).                                                       |
| 7-11d   | `3992b967` | `assemble.ts` history window + bias rows: async `fillHistoryAndBias` runs `buildHistoryWindow` (thread `currentChat`/`triggerResult`/`varChanged`, honor `stopSending`, fold `addedTokens`, capture `historyMessages`) + unescaped/expanded `biases`. `NO_ASSETS` exported.     |
| 7-11e   | `dd4bd14c` | `assemble.ts` memory bridge + post-history: `memory.ts` `buildMemoryWindow` (non-Hypa budget trim → `lastChat` promotion → memory split → `unformated.chats`) + `fillMemoryAndPostHistory` (window → `applyDepthPrompts` splice → `additonalSysPrompt` placement).              |
| 7-11f   | `3492bede` | `assemble.ts` final render + budget: `renderAndBudget` (`renderFinalPrompt` → `finalizeRequestBudget`, overflow → `abortReason`) + `assemblePrompt` chains 7-11a–f and returns the `AssembleResult` (`prompt` payload + dispatch metadata) or `{ stopSending }`. Throw removed. |
| 7-11g   | `89a80c19` | Wired `POST /api/v1/generate/chat`: route takes `dataDir`, binds `loadDatabase` to `loadPersisted`, maps body → `AssembleInput`, and streams `stage(validate)` → `stage(prompt,start)` → `prompt` → `stage(prompt,end)` → `done` (SSE `error` on `stopSending`/throw).          |
| 7-11h   | `24a8b0fe` | Added `POST /api/v1/generate/preview-prompt`: one-shot **JSON** shortcut (`validatePreview` + forced `preview_prompt` mode) returning `result.prompt`, `{ stopSending, abortReason }`, or an HTTP 404 (`EntityNotFoundError`) for bad IDs / missing DB.                         |
| 7-11i   | `807f5d1a` | Added the `info` SSE event to `/chat`: timings + token counts emitted on the success path (after `prompt`/`stage(prompt,end)`, before `done`); `outputTokens` rides on a new `InfoEvent.responseBudget` field. `/preview-prompt` unchanged; `message_patch` deferred to 7-12.   |

What is real in code:

- `server/fastify/src/routes/generationChat.ts` registers two routes.
  `POST /api/v1/generate/chat` validates the body (pre-stream 400),
  then calls `assemblePrompt` and streams `stage(validate)` →
  `stage(prompt,start)` → `prompt` → `stage(prompt,end)` → `info` →
  `done`; the `info` event (7-11i) carries the assembly `timings.prompt`
  duration, `tokens.{prompt,total}`, and the clamped `responseBudget`,
  and rides only on the success path. A `stopSending` result or any
  thrown error (bad IDs, missing database) becomes a terminal SSE
  `error` + `done` (no `info`). `POST
/api/v1/generate/preview-prompt` (7-11h) is the one-shot **JSON**
  variant: it returns the `result.prompt` payload, `{ stopSending,
abortReason }`, or a real HTTP **404** for `EntityNotFoundError` (no
  SSE head). Both bind `loadDatabase` to `loadPersisted(dataDir).database`
  (read-only — `varChanged` persistence + provider dispatch are 7-12).
- Prompt leaves are implemented and tested: variables/SSE taxonomy,
  static/plain sections, async feature-complete `history.ts`
  (multimodal inlays, `{{asset_prompt::}}`, `addedTokens`,
  depth-prompt preflight, and `runStartTrigger`), regex scripts
  through preset + character + module chains, module helpers for
  regex/assets/triggers, lorebook constant/keyword/recursive/depth/
  budget activation, minimal tiktoken-based token counting, template
  preflight, final request-budget pruning, and shared tokenizer config.
- `triggers.ts`, `triggerVars.ts`, and `triggerDataEffects.ts` cover
  the Phase 7-safe runner through 7-9f: trigger collection/filtering,
  variable/condition evaluation, deterministic V1 effects, V2 control
  flow and safe data helpers, request/display state adapters, bounded
  recursive trigger calls, token accounting, `varChanged`, and the
  `runStartTrigger` handoff. Browser plugin/Lua hooks, low-level
  effects, and persistent resource mutations stay deferred.
- `templates.ts` is the **complete** template renderer. It holds the
  7-10a foundation, 7-10b content cards, the 7-10c chat/systemized-chat
  path, the 7-10d `memory` / `cache` cards, the 7-10e prompt-info
  capture + content trim, and the 7-10f top-level `renderFinalPrompt`.
  `renderContentCard` is shared by rendering and `preflight.ts`; it
  returns `null` only for `memory` / `cache`, which `renderByTemplate`
  handles inline. `renderByTemplate` returns `{ formated, promptInfo }`
  (`RenderedTemplate`) and trims its rows; `renderByFormatOrder` trims
  the non-template path. `renderFinalPrompt(args)` is the async entry
  that unifies both paths with the `isContinue` pre-push, the
  `depth_prompt` splice, and the injectable `editRequest` seam,
  returning `{ formated, promptText }`. `preflight.ts` is unchanged — it
  never supplies the prompt-info sink and still keeps only the
  `memoryCardUsed` / `hasCachePoint` flags.
- `assemble.ts` holds the 7-11a–f assembler steps. `beginAssembly`
  (7-11a) resolves scope through the `AssembleDeps.loadDatabase` seam
  (id→index, `EntityNotFoundError` on miss), builds the shared
  `ExpandContext` + `createEmptyUnformatedSlots`, and runs
  `normalizeTemplate` / `buildFormatOrder`, returning the `AssemblyState`
  later slices extend. `fillStaticSlots(state)` (7-11b) fills the
  static/plain slots (plain sections on the non-utility + non-template
  path, plus author note / cot / description / persona).
  `fillLorebookSlots(state)` (7-11c) activates the lorebook, distributes
  the entries via `buildLorebookContext` (in `lorebook.ts`), and runs
  `preflightTemplateTokens`, recording `report` / `positionParser` /
  `depthPrompts` / `currentTokens` / `memoryCardUsed` / `hasCachePoint`.
  `fillHistoryAndBias(state)` (7-11d, async) runs `buildHistoryWindow`
  with `state.report`, threads the start-trigger mutations (`currentChat`
  / `triggerResult` / `varChanged`), honors `stopSending` (short-circuit),
  folds `addedTokens` into `currentTokens`, captures `historyMessages`,
  and collects the unescaped + variable-expanded `biases`.
  `fillMemoryAndPostHistory(state)` (7-11e, sync) runs the non-Hypa
  `buildMemoryWindow` (`memory.ts`) over `historyMessages` — budget trim
  under `db.maxContext`, `lastChat` promotion (non-template), memory
  split, `removable` marking — to fill `unformated.chats` + `state.memories`,
  honors `stopSending`, then splices the depth prompts (`applyDepthPrompts`)
  and places the trigger `additonalSysPrompt` rows into
  `postEverything` / `lastChat`. Hypa V3 summary creation stays Phase 8.
  `renderAndBudget(state)` (7-11f, async) runs `renderFinalPrompt` over
  the complete slots (no `postEverything` re-append; identity
  `editRequest`) then `finalizeRequestBudget`, aborting with
  `abortReason: 'overflow'` when the pinned rows don't fit and otherwise
  stashing `formated` / `inputTokens` / `outputTokens` / `promptText`.
  `assemblePrompt(input, deps)` now **chains 7-11a–f** (surfacing bad-ID
  errors early) and returns the `AssembleResult` — the `prompt` SSE
  payload (`messages` / `promptInfo` / `lorebookActivation`) plus the
  dispatch metadata (`formated` / `biases` / `inputTokens` /
  `outputTokens`) — or `{ stopSending: true, abortReason }` on a
  trigger/overflow abort. The throw is gone. `generationChat.ts`
  exposes both `/chat` (7-11g, SSE) and `/preview-prompt` (7-11h, JSON).
  Tier 3 was re-sliced on 2026-05-24 (the old 7-11a was too large) and
  is now **closed** by 7-11i (the `info` SSE telemetry on `/chat`); the
  next pickup is the Tier 4 browser adapter (7-12a).

Last recorded baselines after 7-11i:

- `pnpm api:test`: 882 across 42 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: passes with existing CSS / bundle-size warnings

## Next Slice — 7-12a client adapter for `/api/v1/generate/chat`

Pick up **7-12a — browser client adapter** (Tier 4).

7-11i (`807f5d1a`) added the `info` SSE event, **closing Tier 3**: both
generation routes exist and the `/chat` SSE taxonomy emitted today
(`stage` / `prompt` / `info` / `error` / `done`) is complete. Tier 4
shrinks the Phase 5 browser-side prompt-extraction modules to thin SSE
iterators that drive the new route. SPA intent: phase doc
`### Tier 4 — Browser adapter`.

### Scope sketch

- add a browser client that POSTs the `AssembleInput`-shaped body to
  `/api/v1/generate/chat`, parses the named SSE events, and surfaces the
  `prompt` payload + `info` telemetry to the existing send-chat flow.
  Gate it behind the same flag the Phase 6 echo adapter used so the
  legacy in-browser path stays the default until the fixture sweep
  (7-12b) is green.
- keep the read-only boundary: dispatch + `varChanged` persistence +
  `message_patch` / `side_effect` are still **Phase 7-12c/d / 6**, so the
  first adapter slice consumes `prompt` + `info` + `error` + `done` only.

### Important boundary note

`message_patch` ("authoritative chat-row deltas") and `side_effect`
remain **dispatch-coupled**: no chat rows are committed in the read-only
assembly path. The adapter should tolerate their absence rather than
require them — they land with provider dispatch (7-12c/d).

### Out of scope (defer)

- provider dispatch + `varChanged` persistence + `message_patch` /
  `side_effect` events — **Phase 7-12c/d / 6**. Hypa V3 stays
  **Phase 8**; browser plugin/Lua + inlay asset lookup stay deferred.

### Verification

```bash
pnpm check
pnpm api:test
pnpm test
pnpm build
```

7-12a is the default next pickup and the first Tier 4 slice. Tier 3 is
closed: the critical-path assembler (7-11a–f) is closed, both routes
(7-11g/h) are real, and `/chat` telemetry (7-11i) is landed.

## Patterns To Keep

- Prefer DI seams over importing Svelte modules from server code.
  Existing patterns: `chatVarBackend.ts`, `parserStateBackend.ts`,
  and `promptVariablesBoot.ts`.
- `promptScope.ts` is a module-level singleton for the active
  database/chat scope. That matches the current single-user
  migration assumption. Switch to `AsyncLocalStorage` only when a
  later phase introduces real concurrent prompt assembly.
- Any user text that may contain parser syntax should flow through
  `expandVariables(input, ctx) -> { text, dirty }`.
- New prompt leaves should return structured values or normalized
  `OpenAIChat[]` arrays, following the Option B normalization used
  by 7-3.

## Boundaries

- Phase 8 owns server-side Hypa V3 memory.
- Phase 9 owns the server-side `.risu` codec and client command
  thinning.
- Plugin code execution stays browser-side for this migration.
- Ooba OAI-compatible, NovelAI text, and NovelList remain local-only
  until Phase 7 gives the server a complete prompt-flattening path.

## Docs And Commits

- Use commit titles like `feat:`, `fix:`, `refactor:`, and `docs:`.
- After a feature slice, update:
  - [`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md)
  - [`docs/fastify/status/next-steps.md`](docs/fastify/status/next-steps.md)
  - this file
- Keep detailed planning in the phase doc and keep this file short.
- Two-commit rhythm per slice (used by 7-7a/b/c/e): a `feat:`
  commit with code + tests, then a `docs:` commit that backfills
  the real SHA into HANDOVER + ROADMAP + phase doc + next-steps.

## Pointers

- [`docs/fastify/status/next-steps.md`](docs/fastify/status/next-steps.md)
  has the immediate work item and landed Phase 6/7 slice tables.
- [`docs/fastify/status/server.md`](docs/fastify/status/server.md)
  tracks the actual Fastify route surface.
- [`docs/fastify/coverage/server-routes.md`](docs/fastify/coverage/server-routes.md)
  tracks route and prompt-leaf test coverage.
- Provider deferral memos:
  [`docs/fastify/design/ooba-oai-compat.md`](docs/fastify/design/ooba-oai-compat.md)
  and
  [`docs/fastify/design/novelai-novellist-stringlize.md`](docs/fastify/design/novelai-novellist-stringlize.md).

## Verification

For docs-only updates:

```bash
pnpm exec prettier --check docs HANDOVER.md
```

For a Phase 7 code slice:

```bash
pnpm check
pnpm api:test
pnpm test
pnpm build
```

Tauri build is verified manually at phase boundaries.
