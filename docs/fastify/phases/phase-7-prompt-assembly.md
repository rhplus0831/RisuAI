# Phase 7 - Server-Side Prompt Assembly

Date: 2026-05-24

Status: in-progress (32 slices landed as of 2026-05-24).
`variables.ts`, `staticSections.ts`, `plainSections.ts`,
`history.ts` (through multimodal inlays + `{{asset_prompt::}}`,
the `applyDepthPrompts` splicer, and the 7-5e `addedTokens`
accumulator + optional depth-prompt token preflight),
`scripts.ts` (regex chain through module regex), `modules.ts`
(`getActiveModules`, `getModuleRegexScripts`, `getModuleAssets`,
`getModuleTriggers`),
`lorebook.ts` (constant + keyword + recursive activation with
`searchMatch`, child mirror, conditional-activation decorators,
recursion loop + `recursivePrompt`, `matchLog`, `inject_lore`
rewrites, the 7-7e depth-prompt helpers `getDepthPrompts` /
`resolvePosition`, and the 7-7d budget-aware truncation chain),
`tokens.ts` (the 7-8a minimal server tokenizer over
`cl100k_base` / `o200k_base`), `preflight.ts` (the 7-8b
template-wide token preflight + `PromptUnformatedSlots` shape),
`budgetFinalize.ts` (the 7-8c request budget finalization), and
`tokenizerConfig.ts` (shared `tokenizerOptionsFromDb` helper used
by `history.ts`, `preflight.ts`, and `budgetFinalize.ts`) are
real. `triggers.ts` now hosts the Phase 7-safe trigger runner —
the 7-9a model + shell, the 7-9b variable/condition engine, the 7-9c
deterministic V1 effects, the V2 control/data batch (7-9d-i
control flow + 7-9d-ii safe data helpers in `triggerDataEffects.ts`),
the 7-9e request/display state adapters (mode allowlists +
`v2Get/SetDisplayState` + the five request-state arms), and the 7-9f
`runStartTrigger` handoff wired into the now-async `buildHistoryWindow`
(closing the Tier 1 7-5d). The trigger and history fronts are complete.
`templates.ts` holds the 7-10a renderer foundation (`normalizeTemplate`,
`buildFormatOrder`, `coalesceRows`, `renderByFormatOrder`, the
`UnformatedPromptSlots` contract), the 7-10b content cards, and the
7-10c `chat` card + `systemizeChat` (the shared `renderContentCard` +
`renderByTemplate`, which `preflight.ts` also consumes); only `memory`
/ `cache` rendering remains (7-10d). `assemble.ts` is still a throwing
stub. See
[Remaining roadmap](#remaining-roadmap) below for the tiered slice
plan, and [`ROADMAP.md`](../../../ROADMAP.md) for the strategic
ordering of the remaining slices.
[`HANDOVER.md`](../../../HANDOVER.md) is the working entry point for
picking up Phase 7.

## Goal

Move Stage 2 (prompt assembly, lorebook activation, persona /
description / author note injection, tokenizer-driven budget
pruning) behind a single Fastify route. The browser stops walking
the preset template; it sends intent and gets back the assembled
OpenAI-shaped payload (or a streamed completion that uses it).

## Preconditions

- Phase 2 closed (server holds presets, lorebooks, personas,
  characters).
- Phase 6 closed (server can dispatch the assembled payload).

## Scope

### Routes

- `POST /api/v1/generate/chat` - high-level intent endpoint.
  Inputs:

  ```jsonc
  {
    "chatId": "...",
    "characterId": "...",
    "presetId": "...",         // optional; defaults to active
    "loadoutId": "...",        // optional
    "mode": "send" | "continue" | "preview" | "preview_prompt"
            | "regenerate",
    "regenerateMessageId": "...",  // when mode === "regenerate"
    "userMessage": "...",          // when mode === "send"
    "resetMessages": true,         // when starting a fresh chat
    "expectedRevision": 1234,
    "inlayAssets": [...],          // browser-uploaded blobs
    "clientCapabilities": {
      "sseEvents": ["stage", "prompt", "info", "token",
                    "message_patch", "side_effect",
                    "warning", "error", "done"]
    }
  }
  ```

  Output: SSE stream with the event types listed above.

- `POST /api/v1/generate/preview-prompt` - shorthand for the
  `preview_prompt` mode. Returns the assembled `messages[]`
  without dispatching to a provider. Useful for DevTools.

### Assembly modules

Under `server/fastify/src/prompt/`:

- `assemble.ts` - walks the preset's `promptTemplate`. Substitutes
  `{{user}}`, `{{char}}`, persona, description, author note,
  example messages, scenario, jailbreak.
- `lorebook.ts` - constant + keyword + recursion, depth-prompt
  metadata, and later budget-aware truncation. Returns activation
  metadata (which entries fired, why) for `prompt` SSE events.
- `history.ts` - chat history shaping (role mapping, multimodal
  fold-in, ChatML-style assembly).
- `templates.ts` - prompt template rendering. This is split into
  normalization, content cards, chat/systemized cards, memory/cache
  cards, position/prompt-info finalization, and the request-edit
  boundary; `renderFinalPrompt.ts` is larger than a single card parser.
- `tokens.ts` - budget pruning. Reuses or ports the existing
  tokenizer surface when the 7-8 token slice lands. The first token
  slice is intentionally tiktoken-only; exact provider tokenizers
  are fixture-driven follow-ups.
- `variables.ts` - `risuChatParser` port for variable expansion,
  `#when`, conditional cards.
- `scripts.ts` - prompt regex script chain used by history and later
  trigger/template paths.
- `modules.ts` - active module helpers for regex scripts, assets,
  and later lorebook/trigger consumers.
- `triggers.ts` - hooks the server-safe trigger runner into prompt
  assembly. Phase 7 ports only deterministic trigger behavior needed
  for prompt/history/request-state handling; browser plugin/Lua and
  low-level resource mutations stay deferred.

### SSE events

The `chat` route streams:

- `stage` - `{ stage: "validate" | "prompt" | "provider" | "done",
status: "start" | "end" }`.
- `prompt` - the assembled `messages[]`, prompt info, lorebook
  activation report.
- `info` - telemetry (timings, token counts).
- `token` - raw provider tokens (non-authoritative; for UX).
- `message_patch` - the authoritative chat row changes.
- `side_effect` - `{ kind: "tts" | "image" | "inlay_screen" |
"hypav3_progress" | "stable_diff", ... }`.
- `warning` - non-fatal issues.
- `error` - terminal error; includes restoration patches.
- `done` - canonical final message + generation info.

### Browser changes

The browser-side prompt extraction modules from Phase 5 shrink to
thin adapters in server-backed mode. The coordinator posts to
`/api/v1/generate/chat` and iterates the stream. The bridge owns:

- UI lease, abort forwarding.
- Inlay asset collection (still browser-only).
- Side-effect dispatch (TTS playback, image preview).
- Local restoration on `error` / abort.

## Boundaries

- **Do not redesign the preset format.** Server reads what the
  browser already writes. Schema migration is out of scope.
- **Do not move memory yet.** This route reads Hypa V3 summaries
  through whatever adapter exists (browser or server) and ships
  them; Phase 8 wires the server-side adapter.
- **Do not implement plugin code execution.** Plugins that expose
  custom prompt items return their text via the existing browser
  bridge for now. Server-side plugin execution is out of the
  migration scope.
- **Do not port whole browser subsystems as support slices.** When a
  helper such as tokenization fans out into provider-specific
  browser assets, plugin hooks, or remote calls, Phase 7 ports only
  the surface needed by the active assembly slice and defers exact
  parity until a fixture demands it.
- **Do not change the SSE event shape across phases.** Once Phase
  7 ships an event, Phase 9 must not rename it.

## Exit criteria

- The Phase 4 / 5 fixture set runs against the server route and
  produces identical observable output (with the upstream provider
  faked at the server boundary).
- `pnpm api:test` includes prompt snapshot tests: given a canned
  database + preset + chat state, `assembled === expected`.
- `pnpm test`, `pnpm check`, `pnpm build`, `pnpm api:test` green.

## Landed slices

| Slice   | Commit     | Summary                                                                                                                                  |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1     | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine-event SSE taxonomy, and added prompt module stubs.                   |
| 7-2a    | `9eed5093` | Added Svelte-free parser DI seams for chat variables and `trigger_id`.                                                                   |
| 7-2b    | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                                            |
| 7-2c    | `7ed156e6` | Wired the server parser adapter and real `expandVariables`.                                                                              |
| 7-3     | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                                  |
| 7-4     | `051a5dcd` | Ported plain prompt sections: main, jailbreak, global note, and role splitting.                                                          |
| 7-5a    | `c44e53fc` | Ported the deterministic history walk: examples, start-new-chat marker, first message, filters, and role mapping.                        |
| 7-6a    | `9a60380d` | Added the minimal regex script processor for preset and character scripts.                                                               |
| 7-5b    | `7ad226b9` | Added per-message scripts, sendName wrapping, `<Thoughts>` extraction, and memo/UUID backfill.                                           |
| 7-6b    | `8414d5c7` | Added scripts `@@`-action prefixes: no-op emotion, inject, move-top/bottom, and repeat-back.                                             |
| 7-6c    | `5aae492b` | Added the `ableFlag` action DSL, outScript prep, `cbs`/`no_end_nl`, and SPA-parity flag defaults.                                        |
| 7-6d    | `cb5675d8` | Wired module regex scripts into the script chain through active-module helpers.                                                          |
| 7-5c    | `50a1770b` | Added history multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module asset triples.                                          |
| 7-7a    | `c815e067` | Ported lorebook constant (always-on) entries with the in-scope decorator scaffold and `inject_lore` rewrites.                            |
| 7-7b    | `25388d7d` | Added lorebook keyword matching: `searchMatch`, child mirror, conditional-activation decorators, and `matchLog`.                         |
| 7-7c    | `b11902ad` | Added lorebook recursive activation: `while (matching)` loop, `recursivePrompt`, recursion decorators.                                   |
| 7-7e    | `c0f3fb3a` | Added lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, `applyDepthPrompts` history splicer.                          |
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

## Remaining roadmap

The work splits into five tiers. Slices inside a tier can run in
parallel by different agents; the inter-tier dependencies in the
"Depends on" annotations are real and must hold. **Decide concrete
LOC + test scope at the start of each slice** — the breakdown below
is the planning resolution, not a contract.

### Tier 1 — Finish partially landed prompt helpers

Order chosen to minimize helper coupling. `assemble.ts` is still a
throwing stub; `templates.ts` holds the 7-10a foundation + 7-10b/c
content + chat cards (only the `memory` / `cache` cards remain, 7-10d).
`tokens.ts` is real at the minimal
text-only surface, and `triggers.ts` is real through the
request/display adapters and the `runStartTrigger` handoff — the
trigger front is complete. The files below are real; `history.ts` is
now feature-complete.

**7-5a … 7-5e — History shaping.** Port `buildHistoryWindow` +
`formatHistoryMessage` from `src/ts/process/promptAssembly/`. The
SPA modules are tightly coupled to Tier 2 infrastructure; split
along the dependency seams:

- **7-5a** — Minimal walk. Examples + `[Start a new chat]` marker
  - first message + `makeMs` filter (`disabled`/`allBefore`) +
    role mapping. ~150 LOC, ~12 tests. Independently shippable.
    **Landed `c44e53fc`** (16 tests, api:test 486 → 502).
- **7-5b** — Per-message script processing + `sendName` wrapper +
  `<Thoughts>` extraction. Depends on Scripts (7-6).
  **Landed `7ad226b9`** (13 tests, api:test 516 → 529).
- **7-5c** — Multimodal inlays + `{{asset_prompt::}}` replacement.
  **Landed `50a1770b`** (13 tests, api:test 569 → 582).
- **7-5d** — Start trigger integration. **Landed `5291a0b0`** (folded
  into 7-9f). `buildHistoryWindow` is async and runs `runStartTrigger`.
- **7-5e** — Tokenizer accumulation + depthPrompts preflight.
  **Landed `febe67ce`** (7 tests, api:test 661 → 668).
  `HistoryWindowResult` gains `addedTokens: number`;
  `buildHistoryWindow` tallies it across examples, the
  start-new-chat marker, the first message, and per-message rows,
  using a tokenizer config derived from `db.aiModel` (gpt →
  overhead 5 / `noName`; everything else → overhead 3 / `name`)
  plus `encodingForModel` for `cl100k_base` / `o200k_base`
  routing. A new optional `report?: LorebookActivationReport`
  trailing parameter triggers a depth-prompt preflight that
  tokenizes each resolved body (same `resolvePosition` +
  `expandVariables` path `applyDepthPrompts` uses) without
  splicing — the splice still happens in `applyDepthPrompts` so
  the SPA's two-step `buildHistoryWindow` (count) → `index.svelte.ts`
  (splice) contract is preserved.

**7-6 — Scripts port.** Port `processScript` + `processScriptFull`
from `src/ts/process/scripts.ts` (431 LOC in the SPA). Now in
progress as sub-slices.

- **7-6a** — Minimal regex chain (preset + character, mode filter,
  flag sanitization, CBS in replacement). **Landed `9a60380d`**
  (14 tests, api:test 502 → 516). Unblocks 7-5b.
- **7-6b** — Special action prefixes: `@@move_top`,
  `@@move_bottom`, `@@inject`, `@@repeat_back` (server-implementable
  deterministic text ops, and a documented `@@emo` no-op since the
  emotion-image side effect is browser-only). **Landed `8414d5c7`**
  (16 tests, api:test 529 → 545). Per-message history walk now
  threads `index` + `currentChat` so these actions fire correctly.
- **7-6c** — `ableFlag` `<order N, actions…>` flag-meta DSL: parse
  `<…>` segments out of `script.flag` into `{order, actions[]}`,
  stable-sort by `order desc`, route `actions.includes('inject' |
'move_top' | 'move_bottom' | 'repeat_back')` to the existing 7-6b
  paths, implement the `'cbs'` action (pre-expand `script.in`) and
  `'no_end_nl'` action (suppress the trailing-`>` newline).
  **Landed `5aae492b`** (12 new + 4 updated tests, api:test 545 →
  557). Also corrected the default-flag-is-`'g'` and
  `ableFlag`-gated-`script.flag` SPA-parity bugs the 7-6a tests
  had silently asserted wrong.
- **7-6d** — Module regex scripts: `server/fastify/src/prompt/modules.ts`
  ports `getModules()` + `getModuleRegexScripts()`; `processScript`
  chain is now `presetRegex` → `char.customscript` → `moduleRegex`.
  **Landed `cb5675d8`** (12 tests across `modules.test.ts` +
  `scripts.test.ts`, api:test 557 → 569).
- **7-6e** — Script-cache (`generateScriptCacheKey` +
  `getScriptCache` + `cacheScript`) and `runTrigger('display', …)`
  for `editdisplay` mode. Both are optional polish: the cache is
  a pure optimization (the server runs each chain fresh per
  assembly), and `editdisplay` is unblocked by the trigger
  request/display adapter (7-9e, `51155665`).

Browser-only paths (`runLuaEditTrigger`, `pluginV2[mode]`) are
out-of-scope for the server port; the SPA continues to use them
client-side.

**7-7a … 7-7e — Lorebook activation.** Port
`src/ts/process/lorebook.svelte.ts` + `buildLorebookContext.ts`.
Tentative breakdown:

- **7-7a** — Constant entries (always-on). **Landed `c815e067`**
  (16 tests in `lorebook.test.ts`, api:test 582 → 598). Decorator
  scaffold covers `role`, `position`, `depth`/`reverse_depth`,
  `end`, `priority`, `ignore_on_max_context`, the four
  `inject_*` forms, and `disable_ui_prompt`; everything else hits
  `default: return false` (SPA parity for unknown decorators) and
  stays literal in the prompt text until its sub-slice lands.
  `inject_lore` rewrites are applied in-pass so 7-7d/7-10 do not
  need a re-walk.
- **7-7b** — Keyword matching activation. **Landed `25388d7d`**
  (18 new tests, api:test 598 → 616). `searchMatch` port for the
  non-recursive single-pass case; in-scope decorators now include
  `additional_keys` (AND-required across queries),
  `exclude_keys`, `exclude_keys_all`, `match_full_word`,
  `match_partial_word`, `scan_depth`, `activate_only_after`,
  `activate_only_every`, `is_greeting`, `probability`,
  `activate`, `dont_activate`, `keep_/dont_activate_after_match`.
  `mode === 'child'` mirrors when the previous same-id parent
  didn't fire. Chat-var keys derive from `entry.id` or
  `pickHashRand(5555, entry.content)` via the new Svelte-free
  `src/ts/util/loreHash.ts`. `matchLog` widens from `never[]` to
  `LoreMatchLogEntry[]`.
- **7-7c** — Recursive activation. **Landed `b11902ad`**
  (8 new tests, api:test 616 → 624). Wraps the per-entry walk
  in an outer `while (matching)` loop, accumulates each fired
  entry's decorator-stripped body into `recursivePrompt`, and
  feeds it back through `searchMatch` (with the new
  `dontSearchWhenRecursive` opt-out). Adds the three recursion
  decorators (`recursive`, `unrecursive`, `no_recursive_search`)
  and the global `loreSettings.recursiveScanning` default.
  `activatedIndexes` keeps each entry firing at most once,
  bounding the outer loop at O(N) passes.
- **7-7d** — Budget-aware truncation. **Landed `f0382df8`** (7
  new tests, api:test 654 → 661). `LoreEntryActive` gains a
  `tokens` field computed at push time under
  `encodingForModel(input.model)`. `activateLorebook` splices a
  priority-desc → budget filter → order-desc chain in place of
  the old single priority-desc sort. Budget resolves to
  `loreSettings.tokenBudget ?? database.loreBookToken ?? 800`,
  matching the SPA migrator default. The filter is strictly
  sequential through priority-desc, so an oversized
  high-priority entry is rejected while a later lower-priority
  entry that fits still slips in. `@@ignore_on_max_context`
  entries (already demoted to `priority = -1000` by 7-7a) sit at
  the tail and get dropped first. Token counts are not
  refreshed after `inject_lore` mutations — same trade-off the
  SPA documents at `lorebook.svelte.ts:649`.
- **7-7e** — Depth-prompt emission for history. **Landed
  `c0f3fb3a`** (16 new tests, api:test 624 → 640).
  `getDepthPrompts(report)` filters for
  `(pos==='depth' && depth>0) || pos==='reverse_depth'`.
  `resolvePosition(text, report, maxDepth=5)` ports
  `buildLorebookContext.ts:36-63` (transitive
  `{{position::pt_<name>}}` substitution, cap-stripped).
  `applyDepthPrompts(messages, ctx, char, report)` lives in
  `history.ts` and mirrors `index.svelte.ts:275-283`:
  splices each entry at `depth` (from start) or
  `length - depth` (from end), re-reading length per
  insertion so the SPA's growing-array semantics hold. The
  helper lives outside `buildHistoryWindow` because the SPA
  itself runs the splice at the assemble root — that keeps
  the 7-5a/b/c walk untouched and lets 7-11b wire this in
  cleanly.

### Tier 2 — Supporting infrastructure

**7-8a … 7-8c — Tokens / budget.** Port the budget callers from
`src/ts/process/promptBudget/{preflightTemplateTokens,
finalizeRequestBudget}.ts`, but do **not** treat 7-8a as a full
SPA tokenizer migration.

Scope re-verification on 2026-05-23 found that
`src/ts/tokenizer.ts` is a 654-line browser dispatcher across 17
tokenizer families (`tik`, Mistral, NovelAI, Claude, Llama,
NovelList, Gemma, Cohere, DeepSeek, GLM, and others). It depends on
Svelte `DBState`, plugin tokenizer hooks, browser-loaded
`/token/...` assets through `@mlc-ai/web-tokenizers`, Google
count-token calls, local GGUF tokenization, and multimodal image
math. Porting that entire dispatcher would exceed the intended
support-slice size and is not required for the immediate Phase 7
consumers.

- **7-8a** — Minimal server tokenizer. **Landed `17fca64f`** (14
  tests, api:test 640 → 654). `server/fastify/src/prompt/tokens.ts`
  exports `TokenEncoding`, `encodingForModel(model)`,
  `tokenize(text, encoding)`, `tokenizeChat(chat, encoding, opts)`,
  and `tokenizeChats(chats, encoding, opts)`. Backed by
  `@dqbd/tiktoken` with `cl100k_base` / `o200k_base`, an explicit
  prefix list (`gpt-4o`, `gpt-4.1`, `gpt-5`, `gpt-oss`, `o1`, `o3`,
  `o4`) routed to `o200k_base` and a conservative `cl100k_base`
  fallback for everything else, plus a module-scope encoder cache.
  Text-only chat counting with default per-message overhead of 4,
  optional `name` (+1 separator), and optional `thoughts[]` (+1
  per entry). Out of scope (deferred until a fixture needs them):
  `@mlc-ai/web-tokenizers`, exact
  Claude/Mistral/Llama/Gemma/Cohere/DeepSeek/NovelAI/NovelList/GLM
  tokenizers, plugin/custom tokenizers, Google remote count-token
  calls, local GGUF models, and multimodal image-token math.
- **7-8b** — Token preflight accounting across the template walker.
  **Landed `d488ab7f`** (27 tests, api:test 668 → 695).
  `server/fastify/src/prompt/preflight.ts` exports
  `preflightTemplateTokens(input) → { addedTokens, memoryCardUsed,
hasCachePoint }` and the `PromptUnformatedSlots` shape the future
  assemble root (7-11a) will feed in. Card coverage matches SPA:
  `persona` / `description` / `authornote` `innerFormat` +
  `defaultText` fallback, `lorebook` pass-through, `postEverything`
  - optional `postEndInnerFormat`, `plain` / `jailbreak` (gated on
    `db.jailbreakToggle`) / `cot` (gated on `db.chainOfThought`) with
    `globalNote` `replaceGlobalNote` wrapping and the inlined
    `prebuiltAssetCommand` constant (suppressed by
    `{{//@customimageinstruction}}`), `chatML` parser (inlined,
    routed through `expandVariables`), `chat` range math (positive,
    negative tail-relative, `'end'`, `-1000`, `start >= end`), and
    `sendChatAsSystem` systemize on a `structuredClone` so the
    caller's `chats` slot is not mutated. `memory` / `cache` cards
    flip flags without touching tokens. Null-template fallback
    tokenizes every slot once. Also lifts `tokenizerOptionsFromDb`
    out of `history.ts` into a shared `tokenizerConfig.ts` so 7-5e
    and 7-8b read the same gpt-vs-non-gpt overhead + `useName`
    rules. Add multimodal image-token accounting here only if a
    fixture makes it observable.
- **7-8c** — Budget finalization. **Landed `c83015b3`** (8 tests,
  api:test 695 → 703). `server/fastify/src/prompt/budgetFinalize.ts`
  exports `finalizeRequestBudget(input)` returning
  `{ ok: true, formated, inputTokens, outputTokens }` or
  `{ ok: false, reason: 'overflow', inputTokens }`. Re-tokenizes a
  flattened `OpenAIChat[]`, trims `removable` rows front-to-back
  until under `maxContextTokens` (blank content, then drop
  emptied non-multimodal rows), and clamps `outputTokens` to the
  remaining headroom. Honors the `removable` flag set upstream
  (`buildMemoryWindow.ts:147`); does not consume the preflight
  output (preflight feeds the memory window, finalize is the
  independent final re-check at `index.svelte.ts:329`). Text-only
  tokenization keeps multimodal image-token math deferred while
  preserving the multimodal-only survival filter.

**7-9a … 7-9g — Triggers.** Port the Phase 7-safe subset of
`src/ts/process/triggers.ts`.

Scope re-verification on 2026-05-23 found that the SPA trigger module
is a 3350-line interpreter with 151 effect `case` arms, V1 + V2
dialects, module-trigger aggregation, request/display allowlists,
manual recursion, chat/scriptstate mutation, prompt-side system prompt
injection, and low-level browser/resource effects. Treating 7-9a as
"the trigger sandbox" would make one slice absorb several independent
subsystems. Phase 7 therefore ports only the deterministic server-side
surface needed by prompt assembly; plugin/Lua execution remains
browser-side, Hypa similarity waits for Phase 8 memory, and persistent
character/persona/lorebook mutations wait for Phase 9 command APIs.

- **7-9a** — Trigger model + runner shell. **Landed `cddc035e`** (17
  tests). Shared types/result shape (`TriggerMode` /
  `TriggerRunContext` / `TriggerRunArg` / `TriggerRunResult`),
  module-trigger aggregation (`getModuleTriggers`), low-level-access
  inheritance, `collectTriggers` + `matchesTrigger` (mode and
  manual-name filtering, `triggercode`/`triggerlua` bypass), recursion
  bookkeeping, trigger-id threading via explicit context, and the
  no-match/no-op `runTrigger` shell. No effect execution yet.
- **7-9b** — Variable and condition engine. **Landed `cb23202b`** (13
  added tests). `createTriggerVarEngine` (`getVar` / `setVar`,
  local-variable scope stack, `displayMode` `tempVars`, `varChanged`),
  `evaluateConditions` (`var` / `value` / `chatindex` / `exists`, all
  operators, expanded via `expandVariables`), `TriggerRunContext`
  extended with `database` / `selectedCharID` / `chatPage`,
  `TriggerRunResult` extended with `varChanged`, and `parseKeyValue`
  lifted into `src/ts/util/parseKeyValue.ts`. Conditions are wired
  into `runTrigger`.
- **7-9c** — Deterministic V1 effects. **Landed `cae61155`** (10
  added tests). `setvar` (numeric ops), `systemprompt` (slot
  accumulation + token count), `impersonate` / `cutchat` /
  `modifychat` (chat-message edits on `result.chat`), `stop`, and
  bounded `runtrigger` recursion (threading `ctx`, OR-ing recursive
  `varChanged`). Effect-loop scaffold + `engine.setChat`. `command`
  and the `lowLevelAccess`-gated arms fall through as no-ops.
- **7-9d** — V2 control flow + safe data effects. Split 2026-05-23
  into:
  - **7-9d-i** — V2 control-flow core. **Landed `1bd8313b`** (9
    added tests). Index-based effect loop, `v2Header`/`v2Comment`/
    `v2ConsoleLog`, `v2SetVar` (`%=`), `v2DeclareLocalVar`,
    `v2If`/`v2IfAdvanced`, `v2Else`, `v2EndIndent`, `v2Loop`/
    `v2LoopNTimes`, `v2BreakLoop`, `v2StopTrigger`,
    `v2StopPromptSending`, bounded `v2RunTrigger`, and the V2 state
    effects `v2CutChat`/`v2ModifyChat`/`v2SystemPrompt`/`v2Impersonate`.
  - **7-9d-ii** — V2 safe data helpers. **Landed `faec5145`** (9
    added tests). `triggerDataEffects.ts` `applyV2DataEffect`
    dispatched from `runTrigger`'s `default`: message readers,
    string/array/dict/math helpers, random, tokenize, `v2RegexTest`,
    quick chat search. (No `v2ExtractRegex` exists in the V2 dialect.)
- **7-9e** — Request/display state adapters. **Landed `51155665`** (5
  added tests). The `display`/`request` effect allowlists (`safeSubset`
  / `displayAllowList` / `requestAllowList`) guarded at the top of the
  effect loop, plus `v2Get/SetDisplayState` and the five request-state
  arms over display text and `OpenAIChat[]` JSON in
  `triggerDataEffects.ts`. Unblocks optional `editdisplay` work in 7-6e
  and the final request-state transform used by assemble/dispatch
  wiring.
- **7-9f** — Prompt/history effects + `start` handoff. **Landed
  `5291a0b0`** (5 added tests). `runStartTrigger` bridges the
  prompt-pipeline `ExpandContext` to a `TriggerRunContext`; the
  now-async `buildHistoryWindow` applies chat mutations, the token
  contribution, `stopSending`, and surfaces `triggerResult` /
  `currentChat` / `varChanged`. Closes Tier 1 7-5d. Applying
  `additonalSysPrompt` to prompt slots is the assemble root's job.
- **7-9g** — Input hook adapter, only if Phase 7 needs the server to
  own Stage 1/user-row trigger behavior before Phase 9. If not, defer
  it to Phase 9.

Deferred beyond Phase 7: browser plugin/Lua trigger execution,
low-level alert/GUI/LLM/image effects, Hypa similarity, command
execution, and persistent character/persona/lorebook mutations.

**7-10a … 7-10f — Preset templates.** Port the render-side logic
from `src/ts/process/promptAssembly/{normalizeTemplate,
renderFinalPrompt,systemizeChat}.ts`. Scope re-verification on
2026-05-23 found that `renderFinalPrompt.ts` is a 397-line renderer
with system-row coalescing, inner-format wrapping, ChatML, memory
cards, cache markers, prompt-info text capture, depth-prompt
insertion, and the final request-edit hook. The old five labels were
too small for the actual coupling, so split by renderer
responsibility:

- **7-10a** — Template normalization + slot contract. **Landed
  `765886be`** (11 added tests). `normalizeTemplate` (utility-bot
  forced template + implicit `postEverything`), `buildFormatOrder`
  (null-template `formatingOrder` fallback), `coalesceRows` (shared
  row-filter / system-coalescing helper), `renderByFormatOrder`
  (branch-free non-template walk), and the canonical
  `UnformatedPromptSlots` contract (re-exported by `preflight.ts`). No
  per-card branches yet.
- **7-10b** — Content cards. **Landed `978ade30`** (10 added tests).
  Shared `renderContentCard` (persona / description / authornote /
  lorebook / postEverything / plain / jailbreak / cot / chatML, with
  inner-format/default-text wrapping, `postEndInnerFormat`, global-note
  replacement + prebuilt asset command, toggle gating) plus
  `renderByTemplate`. `preflight.ts` now consumes the same builder so
  token counting and rendering can't drift. Prompt-info capture for
  these cards is 7-10e.
- **7-10c** — Chat cards + systemized chat. **Landed `0d2e0e17`**
  (9 added tests). The `chat` range math (`-1000`, negative offsets,
  `end`, empty ranges) + `sendChatAsSystem` / `chatAsOriginalOnSystem`
  / example-name handling via `systemizeChat`, lifted into the shared
  `renderContentCard` (clone-before-systemize). `preflight.ts`'s `chat`
  case removed.
- **7-10d** — Memory cards + cache markers. Render `memory` cards
  from the `memories[]` bridge, apply explicit `cache` cards, apply
  automatic cache-point walkback when no cache card exists, and keep
  empty-row filtering stable.
- **7-10e** — Position + prompt-info finalization. Thread
  `resolvePosition` through render locations, trim rendered rows and
  prompt-info rows, and keep the prompt-info array in lockstep with
  card rendering.
- **7-10f** — Render finalization + request-edit boundary. Apply
  character `depth_prompt`, return finalized rows + prompt-info rows,
  and expose the handoff point that 7-11b/dispatch uses for the
  Phase 7-safe request-state transform from 7-9e. Browser Lua
  `editRequest` hooks stay deferred with plugin/Lua execution.

### Tier 3 — Root + route wiring

**7-11a … 7-11e — `assemble.ts` + route.** All Tier 1 + 2 modules
must be real before these land.

- **7-11a** — `assemble.ts` state loader + slot orchestration.
  Resolve database/chat/character/preset scope, build the
  unformatted slots from static/plain/lorebook/history, compute
  token preflight, and collect bias rows. No route dispatch yet.
- **7-11b** — Memory-window bridge + final render. Port the
  non-Hypa budget fallback from
  `src/ts/process/promptAssembly/buildMemoryWindow.ts`, promote
  `lastChat`, split `memories[]` for memory template cards, mark
  removable rows, apply lorebook depth prompts, merge start-trigger
  additional-system-prompt slots, call `templates.ts`, and run final
  budget pruning. Hypa V3 summary creation remains Phase 8.
- **7-11c** — Wire `POST /api/v1/generate/chat` (currently emits
  "not yet implemented") to call `assemble.ts` and emit `prompt`
  - `done` SSE events.
- **7-11d** — Add `POST /api/v1/generate/preview-prompt` shortcut.
- **7-11e** — SSE telemetry: `info` event (timings, token counts),
  `message_patch` for chat-row deltas.

### Tier 4 — Browser adapter

After Tier 3 is real. The browser-side prompt extraction modules
from Phase 5 shrink to thin SSE iterators.

- **7-12a** — Client adapter for `/api/v1/generate/chat`.
- **7-12b** — Dual-mode fixture sweep: re-run the 12 server-backed
  sendChat fixtures through the new `/chat` route.
- **7-12c** — Side-effect dispatch (TTS playback, image preview,
  `hypav3_progress` UX) via the SSE `side_effect` event.
- **7-12d** — Restoration on error / abort from the SSE `error`
  event's restoration payload.

### Tier 5 — Closeout

**7-13 — Phase 7 closeout.** Refresh
`phase-7-prompt-assembly.md` with the Closeout section. Flip
[`HANDOVER.md`](../../../HANDOVER.md) and `next-steps.md` to
Phase 8 (memory) as the next phase. The three providers
deferred for server-owned flattening (Ooba OAI-compat, NovelAI
text, NovelList) can now route through `assemble.ts`; that work
may land as a polish slice before closeout or as the first
post-closeout follow-up.

## Reference

- `move-to-fastify` lands a Phase-7 ancestor as
  `/api/v1/generate/completion-with-assembly`. We are skipping
  that indirection; `chat` is the assembled endpoint.
- `risuai-metatron`'s `chat_generation/prompt_builder.py`,
  `prompt_sections.py`, `prompt_history.py`, `prompt_templates.py`,
  `prompt_budget.py`, `context.py`, `lorebook.py` are the closest
  template at full scale. Plan on the assembly modules being
  smaller than that (the Python port absorbed years of drift).
