# Phase 7 Roadmap

Date: 2026-05-24
Branch: `fastify`

Strategic view of the remaining Phase 7 (server-side prompt
assembly) slices and the order in which they will be carried
out. This file is updated whenever a slice lands or the scope
shifts.

For the day-to-day handoff state (head commit, exact test
counts, next pickup) see [`HANDOVER.md`](HANDOVER.md). For the
narrative phase doc see
[`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md).

## Scope Re-Verification (2026-05-23)

The remaining plan was re-checked against the current prompt,
tokenizer, and trigger code after the tokenizer slice proved wider
than the original wording implied. The first pass found **7-8a**
(already re-scoped and landed) and **7-9 Triggers** (re-scoped below
before implementation starts). The follow-up pass also found that
**7-10 templates** and **7-11 root assembly** were still hiding
multi-subsystem work behind small labels.

- `src/ts/tokenizer.ts` is a 654-line browser dispatcher spanning
  17 tokenizer families, Svelte `DBState`, plugin tokenizer hooks,
  browser `fetch('/token/...')` assets, Google count-token calls,
  local GGUF tokenization, and multimodal image-token math. Treating
  7-8a as "port the dispatcher" would turn a support slice into a
  provider-matrix migration.
- **7-8a is now capped at the minimal server tokenizer surface**
  needed by Phase 7 budget heuristics: explicit-model tiktoken
  helpers (`cl100k_base` / `o200k_base`) plus text-only chat token
  counting. It must not pull in Svelte stores, plugin execution,
  `@mlc-ai/web-tokenizers`, Google remote count-token calls, local
  model tokenizers, or multimodal image math.
- Exact non-tiktoken provider tokenizers are follow-up work and land
  only when a fixture or provider slice needs them. The immediate
  Phase 7 consumers (7-7d lorebook truncation and 7-5e history token
  accumulation) need stable conservative counts, not full tokenizer
  parity.
- `src/ts/process/triggers.ts` is a 3350-line SPA module with 151
  effect `case` arms, V1 + V2 trigger dialects, module-trigger
  aggregation, request/display allowlists, recursive manual triggers,
  script-state mutation, prompt-side system-prompt injection, chat
  mutation, and low-level effects that touch alerts, GUI reloads,
  LLM/image generation, Hypa similarity, lorebook/persona/character
  mutation, and browser plugin/Lua execution.
- **7-9 is therefore split into smaller Phase 7-safe slices.** Phase
  7 ports only the deterministic server-side runner needed for prompt
  assembly, start-trigger history integration, and request/display
  state transforms. Browser plugin/Lua execution stays out of scope;
  low-level effects that need Hypa V3 memory wait for Phase 8; effects
  that mutate server-owned resources wait for Phase 9 command APIs.
- `src/ts/process/promptAssembly/renderFinalPrompt.ts` is a
  397-line renderer, not a simple template-card mapper. It combines
  template normalization, null-template `formatingOrder`, system-row
  coalescing, inner-format wrapping, ChatML parsing, chat range math,
  memory cards, explicit and automatic cache markers, position
  substitution, prompt-info text capture, depth-prompt insertion, and
  the final request-edit hook. Treating the old 7-10a/b/c/d/e labels
  as equally small would push renderer state and trigger coupling into
  whichever slice lands first.
- **7-10 is therefore split by renderer responsibility.** The first
  slice creates the normalized template + slot contract; later slices
  add content cards, chat/systemized cards, memory/cache cards, and
  finalization/request-edit boundary. Browser Lua edit hooks remain
  out of scope.
- The assembly root is also larger than a single "stitch modules
  together" slice. `src/ts/process/index.svelte.ts` still performs the
  preflight -> history -> memory-window -> trigger-prompt merge ->
  render -> final budget -> dispatch sequence, and
  `buildMemoryWindow.ts` owns budget fallback trimming plus the
  `memory` template-card split. Phase 7 should make that bridge
  explicit without porting Hypa V3 summarization; Phase 8 owns the
  server memory worker.

## Landed slices

| Slice   | Commit     | Summary                                                                                                                                  |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1     | `3d2426c4` | Scaffolded `POST /api/v1/generate/chat`, locked the 9-event SSE taxonomy, and added the stubs.                                           |
| 7-2a    | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                                          |
| 7-2b    | `bb2c78b5` | Lifted `risuChatParser` + helpers into Svelte-free modules.                                                                              |
| 7-2c    | `7ed156e6` | Wired the server parser adapter and the real `expandVariables`.                                                                          |
| 7-3     | `d0a2a7f3` | Ported static prompt sections (description / author note / persona / chain-of-thought).                                                  |
| 7-4     | `051a5dcd` | Ported plain prompt sections (main / jailbreak / global note).                                                                           |
| 7-5a    | `c44e53fc` | Minimal history walk (examples + start-new-chat marker + first message + makeMs + role map).                                             |
| 7-6a    | `9a60380d` | Minimal regex script processor (preset + character, mode filter, flag sanitization, CBS).                                                |
| 7-5b    | `7ad226b9` | History per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill.                                           |
| 7-6b    | `8414d5c7` | Scripts `@@`-action prefixes (`@@emo`, `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`).                                      |
| 7-6c    | `5aae492b` | `ableFlag` `<order, actions>` DSL + outScript prep + SPA-parity flag defaults.                                                           |
| 7-6d    | `cb5675d8` | Module regex scripts wired into the script chain via `getActiveModules` + `getModuleRegexScripts`.                                       |
| 7-5c    | `50a1770b` | History multimodal inlays + `{{asset_prompt::}}` with `AssetLookup` and module assets.                                                   |
| 7-7a    | `c815e067` | Lorebook constant (always-on) entries + decorator scaffold + `inject_lore` rewrites.                                                     |
| 7-7b    | `25388d7d` | Lorebook keyword matching: `searchMatch`, child mirror, conditional-activation decorators, `matchLog`.                                   |
| 7-7c    | `b11902ad` | Lorebook recursive activation: `while (matching)` loop, `recursivePrompt`, recursive/unrecursive/no_recursive_search decorators.         |
| 7-7e    | `c0f3fb3a` | Lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.                            |
| 7-8a    | `17fca64f` | Minimal server tokenizer: `encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats` over `cl100k_base` / `o200k_base`.             |
| 7-7d    | `f0382df8` | Lorebook budget-aware truncation: per-entry `tokens`, priority-desc filter, `loreSettings.tokenBudget` resolution.                       |
| 7-5e    | `febe67ce` | History `addedTokens` accumulator + depth-prompt token preflight when a `LorebookActivationReport` is supplied.                          |
| 7-8b    | `d488ab7f` | Template-wide token preflight: `preflightTemplateTokens` walks the card list returning `{ addedTokens, memoryCardUsed, hasCachePoint }`. |
| 7-8c    | `c83015b3` | Request budget finalization: `finalizeRequestBudget` trims `removable` rows under `maxContextTokens` and clamps `outputTokens`.          |
| 7-9a    | `cddc035e` | Trigger model + runner shell: `getModuleTriggers`, `collectTriggers`, `matchesTrigger`, and the effect-free `runTrigger` shell.          |
| 7-9b    | `cb23202b` | Trigger variables + conditions: `createTriggerVarEngine`, `evaluateConditions`, context/result extension, `parseKeyValue` lift.          |
| 7-9c    | `cae61155` | Deterministic V1 effects: `setvar`, `systemprompt`, `impersonate`, `stop`, `cutchat`, `modifychat`, bounded `runtrigger` recursion.      |
| 7-9d-i  | `1bd8313b` | V2 control-flow core: index-based loop, `v2If`/`v2Else`/`v2EndIndent`/loops/`v2BreakLoop`, `v2SetVar`, `v2RunTrigger`, V2 state effects. |
| 7-9d-ii | `faec5145` | V2 safe data helpers (`triggerDataEffects.ts`): message readers, string/array/dict/math, random, tokenize, regex, quick search.          |
| 7-9e    | `51155665` | Request/display state adapters: `display`/`request` effect allowlists + `v2Get/SetDisplayState` + the five request-state arms.           |
| 7-9f    | `5291a0b0` | Start-trigger handoff (`runStartTrigger`) wired into async `buildHistoryWindow`; closes Tier 1 7-5d. Trigger + history fronts complete.  |
| 7-10a   | `765886be` | Template renderer foundation: `normalizeTemplate`, `buildFormatOrder`, `coalesceRows`, `renderByFormatOrder`, `UnformatedPromptSlots`.   |
| 7-10b   | `978ade30` | Content cards: shared `renderContentCard` + `renderByTemplate`; `preflight.ts` refactored to consume the same per-card builder.          |
| 7-10c   | `0d2e0e17` | Chat cards + systemized chat: `chat` range math + `systemizeChat` lifted into `renderContentCard`; `preflight.ts` `chat` case removed.   |

## Remaining Slices

Slices are numbered in the default pickup order. Optional polish is
called out separately and should not block Phase 7 closeout unless a
fixture or adapter forces it.

### Tier 1 — Finish partially landed prompt helpers

History (`history.ts`):

- **7-5d** — start trigger integration. **Landed `5291a0b0`**
  (folded into 7-9f). `buildHistoryWindow` is now async and runs the
  start trigger via `runStartTrigger`. History is feature-complete;
  7-5e (`febe67ce`) had already landed the `addedTokens` accumulator +
  depth-prompt preflight.

Scripts (`scripts.ts`):

- **7-6e** — script-cache (pure optimization; the server runs
  each chain fresh per assembly so this is **optional polish**)
  and `runTrigger('display', …)` for `editdisplay` mode (unblocked
  by 7-9e).

Lorebook (`lorebook.ts`):

- No remaining lorebook slices. 7-7d (`f0382df8`) closed out the
  activation/truncation chain.

### Tier 2 — Supporting infrastructure

Tokens / budget:

- Chain closed. 7-8a (`17fca64f`) tokenizer, 7-8b (`d488ab7f`)
  template preflight, and 7-8c (`c83015b3`) request finalization
  are all in. Multimodal image-token accounting stays deferred
  per the 2026-05-23 scope re-verification.

Triggers (`triggers.ts`):

- **7-9a** — trigger model + runner shell. **Landed `cddc035e`.**
  Svelte-free trigger types/result shapes (`TriggerMode` /
  `TriggerRunContext` / `TriggerRunArg` / `TriggerRunResult`),
  `getModuleTriggers` + `collectTriggers` (cloned, inherited
  `lowLevelAccess`), `matchesTrigger` (mode/manual filter +
  `triggercode`/`triggerlua` bypass), and the `runTrigger` shell
  (input cloning, no-trigger `null`, recursion/trigger-id threading,
  no-op effect seam, terminal token accounting). No effect execution.
- **7-9b** — variable and condition engine. **Landed `cb23202b`.**
  `createTriggerVarEngine` (`getVar` / `setVar`, local-variable scope
  stack, `displayMode` `tempVars`, `varChanged`), `evaluateConditions`
  (`var` / `value` / `chatindex` / `exists`, all operators, expanded
  via `expandVariables`), `TriggerRunContext` extended with
  `database` / `selectedCharID` / `chatPage`, `TriggerRunResult`
  extended with `varChanged`, and `parseKeyValue` lifted into a
  Svelte-free module. Conditions are wired into `runTrigger`.
- **7-9c** — deterministic V1 effect core. **Landed `cae61155`.**
  `setvar` (numeric ops), `systemprompt` (slot accumulation + token
  count), `impersonate` / `cutchat` / `modifychat` (chat-message edits
  on `result.chat`), `stop`, and bounded `runtrigger` recursion
  (`recursiveCount < 10` unless `lowLevelAccess`, threading `ctx` +
  OR-ing recursive `varChanged`). Effect-loop scaffold tracks
  `currentIndent` via `engine.setIndent`; `engine.setChat` repoints
  after the `runtrigger` chat reassignment. `command` and the
  `lowLevelAccess`-gated arms fall through as no-ops.
- **7-9d** — V2 control flow + safe data effects. Split on
  2026-05-23 (implementation check: ~50 arms spanning a structural
  control-flow change + a large mechanical leaf-arm batch) into:
  - **7-9d-i** — V2 control-flow core. **Landed `1bd8313b`.**
    Index-based effect loop, `v2Header`/`v2Comment`/`v2ConsoleLog`,
    `v2SetVar` (`%=`), `v2DeclareLocalVar`, `v2If`/`v2IfAdvanced`
    (`∈`/`∋`/`∌`/`≒`/`≡` + fail-skip), `v2Else`, `v2EndIndent`
    (loop-back + lag guard + `clearLocalVarsAtIndent`),
    `v2Loop`/`v2LoopNTimes`, `v2BreakLoop`, `v2StopTrigger`,
    `v2StopPromptSending`, bounded `v2RunTrigger`, and the V2 state
    effects `v2CutChat`/`v2ModifyChat`/`v2SystemPrompt`/`v2Impersonate`.
  - **7-9d-ii** — V2 safe data helpers. **Landed `faec5145`.** The
    side-effect-free leaf arms in `triggerDataEffects.ts`
    (`applyV2DataEffect`, dispatched from `runTrigger`'s `default`):
    message readers, string / array / dict / math helpers, random,
    tokenize, `v2RegexTest`, and quick chat search. (There is no
    `v2ExtractRegex` in the V2 dialect; the only `extractRegex` arm is
    V1 + `lowLevelAccess`-gated and stays deferred.)
- **7-9e** — request/display state adapters. **Landed `51155665`.**
  The `display`/`request` effect allowlists (`safeSubset` /
  `displayAllowList` / `requestAllowList`) guarded at the top of the
  effect loop, plus `v2Get/SetDisplayState` and the five request-state
  arms over `OpenAIChat[]` JSON and display text in
  `triggerDataEffects.ts`. Unblocks optional `runTrigger('display', …)`
  work in 7-6e and the final request-state transform used by
  assemble/dispatch wiring.
- **7-9f** — prompt/history effects + `start` trigger handoff.
  **Landed `5291a0b0`.** `runStartTrigger` bridges the prompt-pipeline
  `ExpandContext` scope to a `TriggerRunContext` and runs the `start`
  trigger; `buildHistoryWindow` (now async) applies chat mutations, the
  token contribution, `stopSending`, and surfaces `triggerResult` /
  `currentChat` / `varChanged`. Closes Tier 1 7-5d. Applying
  `triggerResult.additonalSysPrompt` to prompt slots is the assemble
  root's job (Tier 3).
- **7-9g** — input hook adapter, if still required before the Phase 7
  browser adapter. Keep this limited to `runTrigger('input', …)` and
  editinput regex processing for the server-created user row. If Stage
  1 ownership remains browser-side until Phase 9, defer this slice to
  Phase 9 instead of blocking Phase 7 closeout.
- Deferred beyond Phase 7: plugin/Lua trigger execution,
  low-level LLM/image/alert/GUI effects, Hypa similarity, persistent
  character/persona/lorebook mutations, and server command execution.

Preset templates (`templates.ts`):

- **7-10a** — template normalization + slot contract. **Landed
  `765886be`.** `normalizeTemplate` (utility-bot forced template +
  implicit `postEverything`), `buildFormatOrder` (null-template
  `formatingOrder` fallback), `coalesceRows` (shared row-filter /
  system-coalescing helper), `renderByFormatOrder` (branch-free
  non-template walk), and the canonical `UnformatedPromptSlots` slot
  contract (re-exported by `preflight.ts`). No per-card branches yet.
- **7-10b** — content cards. **Landed `978ade30`.** Shared
  `renderContentCard` for persona / description / authornote /
  lorebook / postEverything / plain / jailbreak / cot / chatML
  (inner-format/default-text wrapping, `postEndInnerFormat`,
  global-note replacement + prebuilt asset command, toggle gating)
  plus `renderByTemplate`. `preflight.ts` refactored to consume the
  same builder so token counting and rendering can't drift.
  Prompt-info capture for these cards is 7-10e.
- **7-10c** — chat cards + systemized chat. **Landed `0d2e0e17`.**
  The `chat` card range math (`-1000`, negative offsets, `end`, empty
  ranges) + `sendChatAsSystem` / `chatAsOriginalOnSystem` / example-name
  handling via `systemizeChat` (lifted into the shared
  `renderContentCard`, clone-before-systemize). `preflight.ts`'s `chat`
  case removed; it now consumes the shared builder for chat too.
- **7-10d** — memory cards + cache markers. Render `memory` cards
  from the `memories[]` bridge, apply explicit `cache` cards, apply
  automatic cache-point walkback when no cache card exists, and keep
  empty-row filtering stable.
- **7-10e** — position + prompt-info finalization. Thread
  `resolvePosition` through render locations, trim rendered rows and
  prompt-info rows, and keep the prompt-info array in lockstep with
  card rendering.
- **7-10f** — render finalization + request-edit boundary. Apply
  character `depth_prompt`, return finalized rows + prompt-info rows,
  and expose the handoff point that 7-11b/dispatch uses for the
  Phase 7-safe request-state transform from 7-9e. Browser Lua
  `editRequest` hooks stay deferred with plugin/Lua execution.

Current default pickup: **7-10d** (memory cards + cache markers).
History, lorebook, tokens/budget, triggers, and 7-10a/b/c are already
landed; Phase 7 is now on the remaining template renderer work
(7-10d–f), then Tier 3 root/route wiring.

### Tier 3 — Root + route wiring (all Tier 1 + 2 real)

- **7-11a** — `assemble.ts` state loader + slot orchestration.
  Resolve database/chat/character/preset scope, build the
  unformatted slots from static/plain/lorebook/history, compute
  token preflight, and collect bias rows. No route dispatch yet.
- **7-11b** — memory-window bridge + final render. Port the
  non-Hypa budget fallback from `buildMemoryWindow.ts`, promote
  `lastChat`, split `memories[]` for memory template cards, mark
  removable rows, apply lorebook depth prompts, merge start-trigger
  additional-system-prompt slots, call `templates.ts`, and run final
  budget pruning. Hypa V3 summary creation remains Phase 8.
- **7-11c** — wire `POST /api/v1/generate/chat` to call
  `assemble.ts` and emit `prompt` + `done` SSE events. Currently
  the route emits `phase-7 not yet implemented`.
- **7-11d** — add `POST /api/v1/generate/preview-prompt` shortcut.
- **7-11e** — SSE telemetry: `info` event (timings, token
  counts), `message_patch` for chat-row deltas.

7-11a and 7-11b are the critical-path predecessors; 7-11c/d/e can
each pick up immediately when their direct dep is in.

### Tier 4 — Browser adapter

After Tier 3 is real. The browser-side prompt extraction modules
from Phase 5 shrink to thin SSE iterators.

- **7-12a** — client adapter for `/api/v1/generate/chat`.
- **7-12b** — dual-mode fixture sweep: re-run the 12
  server-backed sendChat fixtures through the new `/chat` route.
- **7-12c** — side-effect dispatch (TTS playback, image preview,
  `hypav3_progress` UX) via the SSE `side_effect` event.
- **7-12d** — restoration on error / abort from the SSE `error`
  event's restoration payload.

### Tier 5 — Closeout

- **7-13** — Phase 7 closeout. Refresh
  `phase-7-prompt-assembly.md` with the Closeout section. Flip
  HANDOVER.md and `next-steps.md` to Phase 8 (memory). The three
  providers deferred for server-owned flattening (Ooba
  OAI-compat, NovelAI text, NovelList) can now route through
  `assemble.ts`; that work may land as a polish slice before
  closeout or as the first post-closeout follow-up.

## Parallelism notes

- 7-10d, 7-10e, and 7-10f should land in order because each adds state
  to the same renderer path.
- After the renderer closes, 7-11a and 7-11b are the critical-path
  assembly slices; 7-11c/d/e can split once their direct deps are in.
- 7-6e is optional polish. Skip in the default order; revisit
  only if profiling demands the script cache or to port
  `runTrigger('display', …)` (unblocked by 7-9e).

## Sequential order (default)

1. **7-10d** — memory cards + cache markers
2. **7-10e** — position + prompt-info finalization
3. **7-10f** — render finalization + request-edit boundary
4. **7-11a** — `assemble.ts` state loader + slot orchestration
5. **7-11b** — memory-window bridge + final render
6. **7-11c** — wire `/api/v1/generate/chat`
7. **7-11d** — `/api/v1/generate/preview-prompt`
8. **7-11e** — SSE telemetry (`info`, `message_patch`)
9. **7-12a** — browser client adapter
10. **7-12b** — dual-mode fixture sweep
11. **7-12c** — side-effect dispatch
12. **7-12d** — error / abort restoration
13. **7-13** — phase 7 closeout

Optional polish slot (skip in default order, revisit on demand):

- **7-6e** — script-cache and `runTrigger('display', …)` for
  `editdisplay`.
- **7-9g** — input hook adapter, only if the Phase 7 browser adapter
  needs server-side Stage 1/user-row trigger ownership before Phase 9.

## Update protocol

When a slice lands:

1. Move the row from the remaining list to **Landed slices**
   with its commit SHA.
2. Trim the now-redundant detail from the sequential order list.

When the roadmap shifts (e.g., a sub-slice gets re-scoped or
combined), keep the **Sequential order** section as the single
source of truth and update the per-tier notes to match. If the
implementation check shows that a slice touches multiple independent
subsystems, split it before work starts and record the boundary here.
