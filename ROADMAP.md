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

The remaining plan was re-checked against the current prompt and
tokenizer code after the tokenizer slice proved wider than the
original wording implied. The only slice whose likely implementation
scope materially exceeded its planning label is **7-8a**.

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

## Landed slices

| Slice | Commit     | Summary                                                                                                                          |
| ----- | ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded `POST /api/v1/generate/chat`, locked the 9-event SSE taxonomy, and added the stubs.                                   |
| 7-2a  | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                                  |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` + helpers into Svelte-free modules.                                                                      |
| 7-2c  | `7ed156e6` | Wired the server parser adapter and the real `expandVariables`.                                                                  |
| 7-3   | `d0a2a7f3` | Ported static prompt sections (description / author note / persona / chain-of-thought).                                          |
| 7-4   | `051a5dcd` | Ported plain prompt sections (main / jailbreak / global note).                                                                   |
| 7-5a  | `c44e53fc` | Minimal history walk (examples + start-new-chat marker + first message + makeMs + role map).                                     |
| 7-6a  | `9a60380d` | Minimal regex script processor (preset + character, mode filter, flag sanitization, CBS).                                        |
| 7-5b  | `7ad226b9` | History per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill.                                   |
| 7-6b  | `8414d5c7` | Scripts `@@`-action prefixes (`@@emo`, `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`).                              |
| 7-6c  | `5aae492b` | `ableFlag` `<order, actions>` DSL + outScript prep + SPA-parity flag defaults.                                                   |
| 7-6d  | `cb5675d8` | Module regex scripts wired into the script chain via `getActiveModules` + `getModuleRegexScripts`.                               |
| 7-5c  | `50a1770b` | History multimodal inlays + `{{asset_prompt::}}` with `AssetLookup` and module assets.                                           |
| 7-7a  | `c815e067` | Lorebook constant (always-on) entries + decorator scaffold + `inject_lore` rewrites.                                             |
| 7-7b  | `25388d7d` | Lorebook keyword matching: `searchMatch`, child mirror, conditional-activation decorators, `matchLog`.                           |
| 7-7c  | `b11902ad` | Lorebook recursive activation: `while (matching)` loop, `recursivePrompt`, recursive/unrecursive/no_recursive_search decorators. |
| 7-7e  | `c0f3fb3a` | Lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.                    |
| 7-8a  | `17fca64f` | Minimal server tokenizer: `encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats` over `cl100k_base` / `o200k_base`.     |
| 7-7d  | `f0382df8` | Lorebook budget-aware truncation: per-entry `tokens`, priority-desc filter, `loreSettings.tokenBudget` resolution.               |
| 7-5e  | `febe67ce` | History `addedTokens` accumulator + depth-prompt token preflight when a `LorebookActivationReport` is supplied.                  |

## Remaining Slices

Slices are numbered in the order they should be picked up.
Slices marked with `(parallel)` can run alongside the previous
slice when staffed by another agent.

### Tier 1 — Finish partially landed prompt helpers

History (`history.ts`):

- **7-5d** — start trigger integration. Blocked on 7-9c.
  This is the only remaining history sub-slice; 7-5e
  (`febe67ce`) landed the `addedTokens` accumulator + depth-prompt
  preflight.

Scripts (`scripts.ts`):

- **7-6e** — script-cache (pure optimization; the server runs
  each chain fresh per assembly so this is **optional polish**)
  and `runTrigger('display', …)` for `editdisplay` mode (blocked
  on Triggers 7-9).

Lorebook (`lorebook.ts`):

- No remaining lorebook slices. 7-7d (`f0382df8`) closed out the
  activation/truncation chain.

### Tier 2 — Supporting infrastructure

Tokens (`tokens.ts`):

- **7-8b** — token preflight accounting across the template walker.
  Builds on 7-8a (`17fca64f`). Add multimodal image-token accounting
  here only if a fixture needs it.
- **7-8c** — budget finalization (pruning order, fallback
  chains) (after 7-8b).

Triggers (`triggers.ts`):

- **7-9a** — trigger sandbox infrastructure. May reuse 7-6's
  `processScript` for trigger bodies.
- **7-9b** — `editInput` / `editRequest` hooks (after 7-9a).
- **7-9c** — `start` trigger; consumed by 7-5d (after 7-9a).

Preset templates (`templates.ts`):

- **7-10a** — card parsing + normalization.
- **7-10b** — chat range cards (after 7-10a).
- **7-10c** — cache markers (after 7-10a).
- **7-10d** — position slots (after 7-10a).
- **7-10e** — systemized chat hoisting (after 7-10a).

7-8a (`17fca64f`), 7-7d (`f0382df8`), and 7-5e (`febe67ce`) are in.
The next default pickup is **7-8b** (template-wide preflight) →
**7-8c** (final budget pruning). After that, 7-9a → 7-9b/9c for
triggers, and 7-10a → 7-10b/c/d/e for templates.

### Tier 1 sub-slices unblocked by Tier 2

- **7-5d** — start trigger integration (needs 7-9c). The only
  remaining Tier 1 sub-slice; lands as soon as 7-9c is in.

These slot in as soon as their Tier 2 dependencies land. Do
**not** wait for all of Tier 2 — pick them up the moment their
specific dep is in.

### Tier 3 — Root + route wiring (all Tier 1 + 2 real)

- **7-11a** — `assemble.ts` root entry stitching static +
  plain + lorebook + history + tokens through templates.
- **7-11b** — wire `POST /api/v1/generate/chat` to call
  `assemble.ts` and emit `prompt` + `done` SSE events. Currently
  the route emits `phase-7 not yet implemented`.
- **7-11c** — add `POST /api/v1/generate/preview-prompt` shortcut.
- **7-11d** — SSE telemetry: `info` event (timings, token
  counts), `message_patch` for chat-row deltas.

7-11a is the critical-path predecessor; 7-11b/c/d can each pick
up immediately when their direct dep is in.

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
- The biggest parallel-able fronts are now **7-8b**
  (template-wide preflight; the next default), **7-9a** (kicks off
  triggers), and **7-10a** (kicks off templates). 7-5d is the
  remaining Tier 1 sub-slice and unblocks the moment 7-9c lands.
- 7-6e is optional polish. Skip in the default order; revisit
  only if profiling demands the script cache or if Triggers
  (7-9) opens the door to porting `runTrigger('display', …)`.

## Sequential order (default)

1. **7-8b** — token preflight
2. **7-8c** — budget finalization
3. **7-9a** — trigger sandbox
4. **7-9b** — `editInput` / `editRequest` hooks
5. **7-9c** — `start` trigger
6. **7-5d** — history start trigger (unblocked by 7-9c)
7. **7-10a** — template card parsing
8. **7-10b** — chat range cards
9. **7-10c** — cache markers
10. **7-10d** — position slots
11. **7-10e** — systemized chat hoisting
12. **7-11a** — `assemble.ts` root entry
13. **7-11b** — wire `/api/v1/generate/chat`
14. **7-11c** — `/api/v1/generate/preview-prompt`
15. **7-11d** — SSE telemetry (`info`, `message_patch`)
16. **7-12a** — browser client adapter
17. **7-12b** — dual-mode fixture sweep
18. **7-12c** — side-effect dispatch
19. **7-12d** — error / abort restoration
20. **7-13** — phase 7 closeout

Optional polish slot (skip in default order, revisit on demand):

- **7-6e** — script-cache and `runTrigger('display', …)` for
  `editdisplay`.

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
