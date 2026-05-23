# HANDOVER

Date: 2026-05-24
Branch: `fastify`
Head: `0d2e0e17 feat: template chat cards + systemized chat (Phase 7-10c)`

The strategic view of remaining Phase 7 slices lives in
[`ROADMAP.md`](ROADMAP.md). This file stays as the day-to-day
handoff with the current head, baselines, and the next pickup.

This is the short runbook for picking up **Phase 7 in progress**.
Phases 0-6 are closed. The detailed Phase 7 roadmap lives in
[`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md);
this file only records the current handoff state and the next slice.

## Current State

Landed Phase 7 slices:

| Slice   | Commit     | Summary                                                                                                                                                                                           |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1     | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine prompt SSE event names, and added prompt module shells.                                                                       |
| 7-2a    | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                                                                                                   |
| 7-2b    | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                                                                                                     |
| 7-2c    | `7ed156e6` | Wired the server parser adapter: `promptScope.ts`, `cbsAdapter.ts`, `promptVariablesBoot.ts`, and real `expandVariables`.                                                                         |
| 7-3     | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                                                                                           |
| 7-4     | `051a5dcd` | Ported plain prompt sections: main, jailbreak, and global note.                                                                                                                                   |
| docs    | `e7a76f32` | Organized the remaining Phase 7 roadmap into tiers.                                                                                                                                               |
| 7-5a    | `c44e53fc` | Ported the minimal history walk: examples, start-new-chat marker, first message, makeMs filter, per-message role mapping.                                                                         |
| 7-6a    | `9a60380d` | Ported the minimal regex script processor: preset+character regex chain, mode filter, flag sanitization, CBS in replacement.                                                                      |
| 7-5b    | `7ad226b9` | Added per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill on the history walk.                                                                                  |
| 7-6b    | `8414d5c7` | Added scripts `@@`-action prefixes: `@@emo` (no-op), `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`.                                                                                  |
| 7-6c    | `5aae492b` | Added `ableFlag <order, actions>` DSL, `cbs`/`no_end_nl` actions, outScript prep, and SPA-parity flag defaults.                                                                                   |
| 7-6d    | `cb5675d8` | Wired module regex scripts into the script chain via new `getActiveModules` + `getModuleRegexScripts` helpers.                                                                                    |
| 7-5c    | `50a1770b` | Added history multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module asset triples.                                                                                                   |
| 7-7a    | `c815e067` | Ported lorebook constant (always-on) entries with the in-scope decorator scaffold and `inject_lore` rewrites.                                                                                     |
| 7-7b    | `25388d7d` | Added lorebook keyword matching: `searchMatch` port, child mirror, conditional-activation decorators, and `matchLog`.                                                                             |
| 7-7c    | `b11902ad` | Added lorebook recursive activation: `while (matching)` loop, `recursivePrompt` accumulation, three recursion decorators.                                                                         |
| 7-7e    | `c0f3fb3a` | Added lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.                                                                               |
| 7-8a    | `17fca64f` | Minimal server tokenizer: `encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats` over `cl100k_base` / `o200k_base`.                                                                      |
| 7-7d    | `f0382df8` | Lorebook budget-aware truncation: per-entry `tokens`, priority-desc filter, `loreSettings.tokenBudget` resolution.                                                                                |
| 7-5e    | `febe67ce` | History `addedTokens` accumulator + depth-prompt token preflight when a `LorebookActivationReport` is supplied.                                                                                   |
| 7-8b    | `d488ab7f` | Template-wide token preflight: `preflightTemplateTokens` walks the card list, returning `{ addedTokens, memoryCardUsed, hasCachePoint }`.                                                         |
| 7-8c    | `c83015b3` | Request budget finalization: `finalizeRequestBudget` trims `removable` rows under `maxContextTokens` and clamps `outputTokens`.                                                                   |
| 7-9a    | `cddc035e` | Trigger model + runner shell: `getModuleTriggers`, `collectTriggers`, `matchesTrigger`, and the `runTrigger` shell (no effect execution).                                                         |
| 7-9b    | `cb23202b` | Trigger variables + conditions: `createTriggerVarEngine`, `evaluateConditions`, context/result extension, `parseKeyValue` lift.                                                                   |
| 7-9c    | `cae61155` | Deterministic V1 effects: `setvar`, `systemprompt`, `impersonate`, `stop`, `cutchat`, `modifychat`, bounded `runtrigger` recursion.                                                               |
| 7-9d-i  | `1bd8313b` | V2 control-flow core: index-based loop, `v2If`/`v2Else`/`v2EndIndent`/loops/`v2BreakLoop`, `v2SetVar`, `v2RunTrigger`, V2 state effects.                                                          |
| 7-9d-ii | `faec5145` | V2 safe data helpers in `triggerDataEffects.ts`: message readers, string/array/dict/math, random, tokenize, regex, quick search.                                                                  |
| 7-9e    | `51155665` | Request/display state adapters: `display`/`request` effect allowlists + `v2GetDisplayState`/`v2SetDisplayState` + the five request-state arms.                                                    |
| 7-9f    | `5291a0b0` | Start-trigger handoff (`runStartTrigger`) wired into async `buildHistoryWindow`: chat mutation, token contribution, `stopSending`, `varChanged`. Closes 7-5d.                                     |
| 7-10a   | `765886be` | Template renderer foundation in `templates.ts`: `normalizeTemplate`, `buildFormatOrder`, `coalesceRows`, `renderByFormatOrder`, and the canonical `UnformatedPromptSlots` contract.               |
| 7-10b   | `978ade30` | Content cards: shared `renderContentCard` (persona/description/authornote/lorebook/postEverything/plain/jailbreak/cot/chatML) + `renderByTemplate`; `preflight.ts` now consumes the same builder. |
| 7-10c   | `0d2e0e17` | Chat cards + systemized chat: `chat` range math + `systemizeChat` lifted into `renderContentCard`; `preflight.ts`'s `chat` case removed (only `memory`/`cache` inline).                           |

What is real in code:

- `server/fastify/src/routes/generationChat.ts` validates request
  bodies and emits `stage(validate)` -> `error` -> `done`; it does
  **not** call `assemble.ts` yet.
- `server/fastify/src/prompt/sseEvents.ts`,
  `variables.ts`, `staticSections.ts`, `plainSections.ts`,
  `history.ts` (deterministic walk + per-message scripts +
  sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill,
  multimodal inlays, `{{asset_prompt::}}`, the `applyDepthPrompts`
  splicer from 7-7e, and the 7-5e `addedTokens` accumulator +
  optional depth-prompt token preflight), `scripts.ts` (full SPA-parity regex chain:
  preset + character + module regex, `@@`-actions, `ableFlag` DSL,
  `cbs` / `no_end_nl` actions, outScript prep), `modules.ts`
  (`getActiveModules` + `getModuleRegexScripts` + `getModuleAssets`),
  and `lorebook.ts` (full activation surface — constant / keyword /
  recursive activation with `searchMatch`, child mirror,
  conditional-activation decorators, recursion loop with
  `recursivePrompt` + `recursive`/`unrecursive`/`no_recursive_search`,
  `matchLog`, `inject_lore` rewrites, `disabledUIPrompts`, plus the
  `getDepthPrompts` / `resolvePosition` depth-prompt helpers) are
  implemented and tested.
- `modules.ts` exports active-module helpers for regex, assets, and
  triggers. `getModuleTriggers` clones entries and applies inherited
  `lowLevelAccess` without mutating module-owned objects.
- `triggers.ts` is the Svelte-free Phase 7-safe runner through
  7-9f: trigger collection/filtering, explicit context threading,
  variable/condition evaluation, deterministic V1 effects, V2 control
  flow, V2 state effects, bounded recursive `runtrigger` /
  `v2RunTrigger`, the `display`/`request` effect allowlists
  (`safeSubset` / `displayAllowList` / `requestAllowList` guarded at the
  top of the effect loop), the mutable `displayState` holder threaded
  from `arg.displayData` to `result.displayData`, terminal token
  accounting, and `varChanged`. It also exports `runStartTrigger`
  (7-9f), the handoff adapter that bridges the prompt-pipeline
  `ExpandContext` scope to a `TriggerRunContext` and runs the `start`
  trigger; `history.ts` consumes it. The trigger front is complete for
  Phase 7.
- `triggerVars.ts` owns the trigger variable engine: `getVar` /
  `setVar`, local scopes, `displayMode` temp vars, `setChat`, and
  persistence into the single database snapshot. `parseKeyValue` was
  lifted to `src/ts/util/parseKeyValue.ts` and re-exported from
  `src/ts/util.ts`.
- `triggerDataEffects.ts` handles the 7-9d-ii side-effect-free V2
  data-helper leaf arms (message readers, string / array / dict /
  math, random, tokenize, regex test, quick chat search) plus the
  7-9e request/display state arms (`v2GetDisplayState` /
  `v2SetDisplayState` and the five request-state arms over a
  JSON `OpenAIChat[]` in `displayState.data`; each gates on
  `displayMode` and maps the SPA `!displayMode` early-return to a
  handled no-op). Browser/plugin/low-level and persistent
  resource-mutation arms remain deferred.
- `tokens.ts` now exports the minimal server tokenizer
  (`encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats`)
  over `cl100k_base` / `o200k_base` with a module-scope encoder
  cache (Phase 7-8a).
- `preflight.ts` runs the template-wide token preflight
  (`preflightTemplateTokens`), returning `{ addedTokens,
memoryCardUsed, hasCachePoint }` and the
  `PromptUnformatedSlots` shape the future assemble root will
  feed in (Phase 7-8b). Its per-card token counting now consumes the
  shared `renderContentCard` from `templates.ts` (7-10b/c) — including
  the `chat` card (7-10c) — so it cannot drift from the renderer; only
  `memory` / `cache` (which set `memoryCardUsed` / `hasCachePoint`)
  stay inline.
- `budgetFinalize.ts` runs the final request budget step
  (`finalizeRequestBudget`): re-tokenizes a flattened
  `OpenAIChat[]`, trims `removable` rows under `maxContextTokens`,
  drops emptied non-multimodal rows, and clamps `outputTokens`,
  returning `{ ok, formated, inputTokens, outputTokens }` or
  `{ ok: false, reason: 'overflow' }` (Phase 7-8c).
- `tokenizerConfig.ts` houses the shared `tokenizerOptionsFromDb`
  helper used by `history.ts` (7-5e), `preflight.ts` (7-8b), and
  `budgetFinalize.ts` (7-8c).
- `templates.ts` holds the 7-10a renderer foundation (the canonical
  `UnformatedPromptSlots` slot contract re-exported by `preflight.ts`
  as `PromptUnformatedSlots`, `normalizeTemplate`, `buildFormatOrder`,
  `coalesceRows`, `renderByFormatOrder`), the 7-10b content cards, and
  the 7-10c `chat` card + `systemizeChat`. `renderContentCard` is the
  shared per-card row builder for persona / description / authornote /
  lorebook / postEverything / plain / jailbreak / cot / chatML / chat,
  returning `null` only for `memory` / `cache`; `renderByTemplate` is
  the template-walk path. `memory` / `cache` rendering and render
  finalization are still deferred (7-10d–f).
- `assemble.ts` still throws a Phase 7 not-implemented error.
  `triggers.ts` is a complete runner: variable/condition engine,
  deterministic V1 effects, V2 control flow, V2 safe data helpers, the
  request/display state adapters, and the `runStartTrigger` handoff
  (7-9a/b/c/d-i/d-ii/e/f). The remaining trigger work (applying
  `triggerResult.additonalSysPrompt` to prompt slots) belongs to the
  assemble root (Tier 3).
- `history.ts` is feature-complete. `buildHistoryWindow` is now `async`
  and runs the start trigger via `runStartTrigger` after the
  first-message push: it re-runs `makeMs` against the mutated chat,
  folds `triggerResult.tokens` into `addedTokens`, early-returns on
  `stopSending`, and surfaces `triggerResult` / `currentChat` /
  `varChanged` in `HistoryWindowResult` (7-9f closes 7-5d). 7-5e
  (`febe67ce`) landed the `addedTokens` accumulator + depth-prompt
  preflight.
- `scripts.ts` does not yet handle script-cache,
  `runLuaEditTrigger`, `runTrigger('display', …)`, or `pluginV2`
  hooks — all 7-6e or out-of-scope.
- `lorebook.ts` covers the full activation surface: constant /
  keyword / recursive / depth-prompt activation, plus the 7-7d
  budget-aware truncation chain (per-entry `tokens` via
  `encodingForModel(input.model)`, priority-desc filter,
  `loreSettings.tokenBudget ?? database.loreBookToken ?? 800`
  resolution). No remaining lorebook slices.
- There is no `/api/v1/generate/preview-prompt` route yet.

Last recorded baselines after 7-10c:

- `pnpm api:test`: 801 across 40 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: passes with existing CSS / bundle-size warnings

## Next Slice — 7-10d memory cards + cache markers

Pick up **7-10d — memory cards + cache markers**.

7-10c (`0d2e0e17`) closed the row-producing cards: `renderContentCard`
now returns `null` only for `memory` / `cache`. 7-10d renders those.
SPA reference is `renderFinalPrompt.ts:301-348`.

### Scope sketch (SPA reference, `renderFinalPrompt.ts`)

- `memory` (`:317-334`): `structuredClone(memories)`, and when
  `card.innerFormat` is set wrap each row via
  `risuChatParser(card.innerFormat).replace('{{slot}}', content)` —
  note memory does **not** run `positionParser` (unlike
  persona/description). Then push. `memories` is an injected
  `OpenAIChat[]` (from `buildMemoryWindow`, Tier 3 / 7-11b); thread it
  in as a new input defaulting to `[]`.
- `cache` (`:335-348`): walks `formated` from the end, setting
  `cachePoint = true` on up to `card.depth` rows whose `role` matches
  `card.role` (or any role when `card.role === 'all'`).
- automatic cache-point (`:301-314`): when `db.automaticCachePoint &&
!hasCachePoint`, set `cachePoint` on the last 3 `user` rows. In the SPA
  this lives at the tail of the `chat` card; decide whether to fold it
  in here (alongside explicit `cache`) or in 7-10f.

### Important structural note

Unlike every card so far, `cache` (and the automatic walk-back)
**mutate the already-accumulated `formated` array** rather than
producing new rows — so they can't be pure `renderContentCard`
row-builders. Handle them in `renderByTemplate` (which owns `formated`),
e.g. branch on `card.type === 'cache'` before the `renderContentCard`
call. `memory` is still a row-builder but needs the `memories` input,
so either extend `ContentCardDeps` with `memories` or handle `memory`
in `renderByTemplate` too. `preflight.ts` keeps `memoryCardUsed` /
`hasCachePoint` (it can't tokenize injected memory rows it isn't given).

### Out of scope (defer)

- Prompt-info text capture (7-10e); render finalization — trim,
  `depth_prompt` splice, Lua `editRequest` (7-10f); the assemble root +
  route wiring — Tier 3 (7-11a onward).

### Verification

```bash
pnpm check
pnpm api:test
pnpm test
pnpm build
```

7-10d is the default next pickup; the template renderer finishes at
7-10e/f, then the Tier 3 root/route wiring.

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
