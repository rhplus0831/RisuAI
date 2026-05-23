# Phase 7 Roadmap

Date: 2026-05-23
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

| Slice | Commit     | Summary                                                                                                                                  |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded `POST /api/v1/generate/chat`, locked the 9-event SSE taxonomy, and added the stubs.                                           |
| 7-2a  | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                                          |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` + helpers into Svelte-free modules.                                                                              |
| 7-2c  | `7ed156e6` | Wired the server parser adapter and the real `expandVariables`.                                                                          |
| 7-3   | `d0a2a7f3` | Ported static prompt sections (description / author note / persona / chain-of-thought).                                                  |
| 7-4   | `051a5dcd` | Ported plain prompt sections (main / jailbreak / global note).                                                                           |
| 7-5a  | `c44e53fc` | Minimal history walk (examples + start-new-chat marker + first message + makeMs + role map).                                             |
| 7-6a  | `9a60380d` | Minimal regex script processor (preset + character, mode filter, flag sanitization, CBS).                                                |
| 7-5b  | `7ad226b9` | History per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill.                                           |
| 7-6b  | `8414d5c7` | Scripts `@@`-action prefixes (`@@emo`, `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`).                                      |
| 7-6c  | `5aae492b` | `ableFlag` `<order, actions>` DSL + outScript prep + SPA-parity flag defaults.                                                           |
| 7-6d  | `cb5675d8` | Module regex scripts wired into the script chain via `getActiveModules` + `getModuleRegexScripts`.                                       |
| 7-5c  | `50a1770b` | History multimodal inlays + `{{asset_prompt::}}` with `AssetLookup` and module assets.                                                   |
| 7-7a  | `c815e067` | Lorebook constant (always-on) entries + decorator scaffold + `inject_lore` rewrites.                                                     |
| 7-7b  | `25388d7d` | Lorebook keyword matching: `searchMatch`, child mirror, conditional-activation decorators, `matchLog`.                                   |
| 7-7c  | `b11902ad` | Lorebook recursive activation: `while (matching)` loop, `recursivePrompt`, recursive/unrecursive/no_recursive_search decorators.         |
| 7-7e  | `c0f3fb3a` | Lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.                            |
| 7-8a  | `17fca64f` | Minimal server tokenizer: `encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats` over `cl100k_base` / `o200k_base`.             |
| 7-7d  | `f0382df8` | Lorebook budget-aware truncation: per-entry `tokens`, priority-desc filter, `loreSettings.tokenBudget` resolution.                       |
| 7-5e  | `febe67ce` | History `addedTokens` accumulator + depth-prompt token preflight when a `LorebookActivationReport` is supplied.                          |
| 7-8b  | `d488ab7f` | Template-wide token preflight: `preflightTemplateTokens` walks the card list returning `{ addedTokens, memoryCardUsed, hasCachePoint }`. |
| 7-8c  | `c83015b3` | Request budget finalization: `finalizeRequestBudget` trims `removable` rows under `maxContextTokens` and clamps `outputTokens`.          |

## Remaining Slices

Slices are numbered in the order they should be picked up.
Slices marked with `(parallel)` can run alongside the previous
slice when staffed by another agent.

### Tier 1 — Finish partially landed prompt helpers

History (`history.ts`):

- **7-5d** — start trigger integration. Blocked on 7-9f.
  This is the only remaining history sub-slice; 7-5e
  (`febe67ce`) landed the `addedTokens` accumulator + depth-prompt
  preflight.

Scripts (`scripts.ts`):

- **7-6e** — script-cache (pure optimization; the server runs
  each chain fresh per assembly so this is **optional polish**)
  and `runTrigger('display', …)` for `editdisplay` mode (blocked
  on 7-9e).

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

- **7-9a** — trigger model + runner shell. Add Svelte-free trigger
  types/result shapes, module-trigger aggregation, low-level-access
  inheritance, mode/manual filtering, recursion bookkeeping, and the
  no-match/no-op path. No effect execution yet.
- **7-9b** — variable and condition engine. Port default-variable
  lookup, chat `scriptstate` read/write, temporary/local variable
  scopes, `trigger_id` threading, and `var` / `value` / `chatindex` /
  `exists` condition checks.
- **7-9c** — deterministic V1 effect core. Port `setvar`,
  `systemprompt`, `impersonate`, `cutchat`, `modifychat`, `stop`, and
  bounded `runtrigger` recursion, including additional-system-prompt
  token accounting. Defer command, alert, LLM, image, similarity, and
  Lua/code effects.
- **7-9d** — V2 control flow + safe data effects. Port the safe subset:
  `v2SetVar`, local vars, `v2If` / `v2IfAdvanced`, `v2Else`,
  `v2EndIndent`, loops/breaks, random, regex test/extract, tokenize,
  string/array/dict/math helpers, quick chat search, and comments.
- **7-9e** — request/display state adapters. Port the request/display
  allowlists plus `v2Get*State` / `v2Set*State` effects over
  `OpenAIChat[]` JSON and display text. This unblocks optional
  `runTrigger('display', …)` work in 7-6e and the final request-state
  transform used by assemble/dispatch wiring.
- **7-9f** — prompt/history effects + `start` trigger handoff. Wire
  the runner into history's start-trigger path, apply chat mutations,
  additional-system-prompt slots, token contribution, and
  `stopSending`. Consumed by 7-5d.
- **7-9g** — input hook adapter, if still required before the Phase 7
  browser adapter. Keep this limited to `runTrigger('input', …)` and
  editinput regex processing for the server-created user row. If Stage
  1 ownership remains browser-side until Phase 9, defer this slice to
  Phase 9 instead of blocking Phase 7 closeout.
- Deferred beyond Phase 7: plugin/Lua trigger execution,
  low-level LLM/image/alert/GUI effects, Hypa similarity, persistent
  character/persona/lorebook mutations, and server command execution.

Preset templates (`templates.ts`):

- **7-10a** — template normalization + slot contract. Port
  `normalizeTemplate`, utility-bot forced template, implicit
  `postEverything`, the null-template `formatingOrder` fallback, and
  the shared row-filter/system-coalescing helper. No individual
  template-card branches yet.
- **7-10b** — content cards. Render persona, description,
  authornote, lorebook, plain/jailbreak/cot, `chatML`, and
  `postEverything` cards, including inner-format/default-text
  wrapping, `postEndInnerFormat`, global-note replacement, the
  prebuilt asset command, and prompt-info capture for these cards.
- **7-10c** — chat cards + systemized chat. Port range math
  (`-1000`, negative offsets, `end`, empty ranges),
  `sendChatAsSystem`, `chatAsOriginalOnSystem`, example-name
  handling, and clone-before-mutation behavior.
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

The tokens / budget chain is fully landed (7-8a `17fca64f`, 7-8b
`d488ab7f`, 7-8c `c83015b3`), along with 7-7d (`f0382df8`) and
7-5e (`febe67ce`). The next default pickup is **7-9a** (trigger
model + runner shell) → 7-9b/c/d/e/f, with **7-10a** → 7-10b/c/d/e/f
for templates as an equally valid parallel front.

### Tier 1 sub-slices unblocked by Tier 2

- **7-5d** — start trigger integration (needs 7-9f). The only
  remaining Tier 1 sub-slice; lands as soon as 7-9f is in.

These slot in as soon as their Tier 2 dependencies land. Do
**not** wait for all of Tier 2 — pick them up the moment their
specific dep is in.

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

- Slices within a tier with no `Blocking` cell can run in
  parallel by different agents.
- The biggest parallel-able fronts are now **7-9a** (kicks off
  triggers; the next default) and **7-10a** (kicks off templates).
  7-5d is the remaining Tier 1 sub-slice and unblocks the moment
  7-9f lands.
- 7-6e is optional polish. Skip in the default order; revisit
  only if profiling demands the script cache or if Triggers
  (7-9e) opens the door to porting `runTrigger('display', …)`.

## Sequential order (default)

1. **7-9a** — trigger model + runner shell
2. **7-9b** — trigger variables + conditions
3. **7-9c** — deterministic V1 effects
4. **7-9d** — V2 control flow + safe data effects
5. **7-9e** — request/display state adapters
6. **7-9f** — prompt/history effects + `start` handoff
7. **7-5d** — history start trigger (unblocked by 7-9f)
8. **7-10a** — template normalization + slot contract
9. **7-10b** — content cards
10. **7-10c** — chat cards + systemized chat
11. **7-10d** — memory cards + cache markers
12. **7-10e** — position + prompt-info finalization
13. **7-10f** — render finalization + request-edit boundary
14. **7-11a** — `assemble.ts` state loader + slot orchestration
15. **7-11b** — memory-window bridge + final render
16. **7-11c** — wire `/api/v1/generate/chat`
17. **7-11d** — `/api/v1/generate/preview-prompt`
18. **7-11e** — SSE telemetry (`info`, `message_patch`)
19. **7-12a** — browser client adapter
20. **7-12b** — dual-mode fixture sweep
21. **7-12c** — side-effect dispatch
22. **7-12d** — error / abort restoration
23. **7-13** — phase 7 closeout

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
