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

## Landed slices

| Slice | Commit     | Summary                                                                                             |
| ----- | ---------- | --------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded `POST /api/v1/generate/chat`, locked the 9-event SSE taxonomy, and added the stubs.      |
| 7-2a  | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                     |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` + helpers into Svelte-free modules.                                         |
| 7-2c  | `7ed156e6` | Wired the server parser adapter and the real `expandVariables`.                                     |
| 7-3   | `d0a2a7f3` | Ported static prompt sections (description / author note / persona / chain-of-thought).             |
| 7-4   | `051a5dcd` | Ported plain prompt sections (main / jailbreak / global note).                                      |
| 7-5a  | `c44e53fc` | Minimal history walk (examples + start-new-chat marker + first message + makeMs + role map).        |
| 7-6a  | `9a60380d` | Minimal regex script processor (preset + character, mode filter, flag sanitization, CBS).           |
| 7-5b  | `7ad226b9` | History per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill.      |
| 7-6b  | `8414d5c7` | Scripts `@@`-action prefixes (`@@emo`, `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`). |
| 7-6c  | `5aae492b` | `ableFlag` `<order, actions>` DSL + outScript prep + SPA-parity flag defaults.                      |
| 7-6d  | `cb5675d8` | Module regex scripts wired into the script chain via `getActiveModules` + `getModuleRegexScripts`.  |
| 7-5c  | `50a1770b` | History multimodal inlays + `{{asset_prompt::}}` with `AssetLookup` and module assets.              |
| 7-7a  | `c815e067` | Lorebook constant (always-on) entries + decorator scaffold + `inject_lore` rewrites.                |

## Remaining Slices

Slices are numbered in the order they should be picked up.
Slices marked with `(parallel)` can run alongside the previous
slice when staffed by another agent.

### Tier 1 — Fill in the remaining assembly stubs

History (`history.ts`):

- **7-5d** — start trigger integration. Blocked on 7-9c.
- **7-5e** — tokenizer accumulation + depth prompts. Blocked
  on 7-8 and 7-7e.

Scripts (`scripts.ts`):

- **7-6e** — script-cache (pure optimization; the server runs
  each chain fresh per assembly so this is **optional polish**)
  and `runTrigger('display', …)` for `editdisplay` mode (blocked
  on Triggers 7-9).

Lorebook (`lorebook.ts`):

- **7-7b** — keyword matching activation. Layers the
  `searchMatch` loop and the conditional-activation decorators
  (`additional_keys`, `exclude_keys*`, `match_*_word`,
  `scan_depth`, `activate_only_after`, `activate_only_every`,
  `is_greeting`, `probability`, `activate`, `dont_activate`,
  `keep_/dont_activate_after_match`) on top of the 7-7a
  scaffold; resolves `mode === 'child'` mirroring.
- **7-7c** — recursive activation within depth limit (after 7-7b).
- **7-7d** — budget-aware truncation (after 7-7c).
- **7-7e** — depth-prompt emission for history (after 7-7d).

Tier 1 ordering continues with 7-7b → 7-7e so the lorebook
decorator scaffold investment compounds before token/depth work.

### Tier 2 — Supporting infrastructure

Tokens (`tokens.ts`):

- **7-8a** — tokenizer integration on the server. The SPA's
  `src/ts/tokenizer.ts` dispatcher is partly environment-
  agnostic; decide reuse vs. port at slice start.
- **7-8b** — token preflight accounting (after 7-8a).
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

Tier 2 ordering: 7-8a → 7-8b → 7-8c first (longest pole; tokens
gate 7-5e), then 7-9a → 7-9b/9c, then 7-10a → 7-10b/c/d/e in
parallel after card parsing lands.

### Tier 1 sub-slices unblocked by Tier 2

- **7-5d** — start trigger integration (needs 7-9c).
- **7-5e** — tokenizer accumulation + depth prompts (needs
  7-7e + 7-8c).

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
- The biggest parallel-able fronts are **7-7b** (continues the
  lorebook chain) / **7-8a** (kicks off tokens) / **7-9a**
  (kicks off triggers) / **7-10a** (kicks off
  templates).
- 7-6e is optional polish. Skip in the default order; revisit
  only if profiling demands the script cache or if Triggers
  (7-9) opens the door to porting `runTrigger('display', …)`.

## Sequential order (default)

1. **7-7b** — lorebook keyword activation
2. **7-7c** — lorebook recursive activation
3. **7-7d** — lorebook budget-aware truncation
4. **7-7e** — lorebook depth-prompt emission
5. **7-8a** — server tokenizer
6. **7-8b** — token preflight
7. **7-8c** — budget finalization
8. **7-9a** — trigger sandbox
9. **7-9b** — `editInput` / `editRequest` hooks
10. **7-9c** — `start` trigger
11. **7-10a** — template card parsing
12. **7-10b** — chat range cards
13. **7-10c** — cache markers
14. **7-10d** — position slots
15. **7-10e** — systemized chat hoisting
16. **7-5d** — history start trigger (unblocked by 7-9c)
17. **7-5e** — history tokenizer + depth prompts (unblocked by
    7-7e + 7-8c)
18. **7-11a** — `assemble.ts` root entry
19. **7-11b** — wire `/api/v1/generate/chat`
20. **7-11c** — `/api/v1/generate/preview-prompt`
21. **7-11d** — SSE telemetry (`info`, `message_patch`)
22. **7-12a** — browser client adapter
23. **7-12b** — dual-mode fixture sweep
24. **7-12c** — side-effect dispatch
25. **7-12d** — error / abort restoration
26. **7-13** — phase 7 closeout

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
source of truth and update the per-tier notes to match.
