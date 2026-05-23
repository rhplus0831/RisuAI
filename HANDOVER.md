# HANDOVER

Date: 2026-05-24
Branch: `fastify`
Head: `2871960f feat: template prompt-info capture + content trim (Phase 7-10e)`
Latest feature slice: `2871960f feat: template prompt-info capture + content trim (Phase 7-10e)`

This is the day-to-day runbook for **Phase 7 in progress**:
current branch head, verification baselines, and the next pickup.
Phases 0-6 are closed. The strategic roadmap lives in
[`ROADMAP.md`](ROADMAP.md), and the detailed phase doc lives in
[`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md);
keep long planning there and keep this file focused on handoff state.

## Current State

Landed Phase 7 slices:

| Slice   | Commit     | Summary                                                                                                                                                                                                    |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1     | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine prompt SSE event names, and added prompt module shells.                                                                                |
| 7-2a    | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                                                                                                            |
| 7-2b    | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                                                                                                              |
| 7-2c    | `7ed156e6` | Wired the server parser adapter: `promptScope.ts`, `cbsAdapter.ts`, `promptVariablesBoot.ts`, and real `expandVariables`.                                                                                  |
| 7-3     | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                                                                                                    |
| 7-4     | `051a5dcd` | Ported plain prompt sections: main, jailbreak, and global note.                                                                                                                                            |
| docs    | `e7a76f32` | Organized the remaining Phase 7 roadmap into tiers.                                                                                                                                                        |
| 7-5a    | `c44e53fc` | Ported the minimal history walk: examples, start-new-chat marker, first message, makeMs filter, per-message role mapping.                                                                                  |
| 7-6a    | `9a60380d` | Ported the minimal regex script processor: preset+character regex chain, mode filter, flag sanitization, CBS in replacement.                                                                               |
| 7-5b    | `7ad226b9` | Added per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill on the history walk.                                                                                           |
| 7-6b    | `8414d5c7` | Added scripts `@@`-action prefixes: `@@emo` (no-op), `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`.                                                                                           |
| 7-6c    | `5aae492b` | Added `ableFlag <order, actions>` DSL, `cbs`/`no_end_nl` actions, outScript prep, and SPA-parity flag defaults.                                                                                            |
| 7-6d    | `cb5675d8` | Wired module regex scripts into the script chain via new `getActiveModules` + `getModuleRegexScripts` helpers.                                                                                             |
| 7-5c    | `50a1770b` | Added history multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module asset triples.                                                                                                            |
| 7-7a    | `c815e067` | Ported lorebook constant (always-on) entries with the in-scope decorator scaffold and `inject_lore` rewrites.                                                                                              |
| 7-7b    | `25388d7d` | Added lorebook keyword matching: `searchMatch` port, child mirror, conditional-activation decorators, and `matchLog`.                                                                                      |
| 7-7c    | `b11902ad` | Added lorebook recursive activation: `while (matching)` loop, `recursivePrompt` accumulation, three recursion decorators.                                                                                  |
| 7-7e    | `c0f3fb3a` | Added lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.                                                                                        |
| 7-8a    | `17fca64f` | Minimal server tokenizer: `encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats` over `cl100k_base` / `o200k_base`.                                                                               |
| 7-7d    | `f0382df8` | Lorebook budget-aware truncation: per-entry `tokens`, priority-desc filter, `loreSettings.tokenBudget` resolution.                                                                                         |
| 7-5e    | `febe67ce` | History `addedTokens` accumulator + depth-prompt token preflight when a `LorebookActivationReport` is supplied.                                                                                            |
| 7-8b    | `d488ab7f` | Template-wide token preflight: `preflightTemplateTokens` walks the card list, returning `{ addedTokens, memoryCardUsed, hasCachePoint }`.                                                                  |
| 7-8c    | `c83015b3` | Request budget finalization: `finalizeRequestBudget` trims `removable` rows under `maxContextTokens` and clamps `outputTokens`.                                                                            |
| 7-9a    | `cddc035e` | Trigger model + runner shell: `getModuleTriggers`, `collectTriggers`, `matchesTrigger`, and the `runTrigger` shell (no effect execution).                                                                  |
| 7-9b    | `cb23202b` | Trigger variables + conditions: `createTriggerVarEngine`, `evaluateConditions`, context/result extension, `parseKeyValue` lift.                                                                            |
| 7-9c    | `cae61155` | Deterministic V1 effects: `setvar`, `systemprompt`, `impersonate`, `stop`, `cutchat`, `modifychat`, bounded `runtrigger` recursion.                                                                        |
| 7-9d-i  | `1bd8313b` | V2 control-flow core: index-based loop, `v2If`/`v2Else`/`v2EndIndent`/loops/`v2BreakLoop`, `v2SetVar`, `v2RunTrigger`, V2 state effects.                                                                   |
| 7-9d-ii | `faec5145` | V2 safe data helpers in `triggerDataEffects.ts`: message readers, string/array/dict/math, random, tokenize, regex, quick search.                                                                           |
| 7-9e    | `51155665` | Request/display state adapters: `display`/`request` effect allowlists + `v2GetDisplayState`/`v2SetDisplayState` + the five request-state arms.                                                             |
| 7-9f    | `5291a0b0` | Start-trigger handoff (`runStartTrigger`) wired into async `buildHistoryWindow`: chat mutation, token contribution, `stopSending`, `varChanged`. Closes 7-5d.                                              |
| 7-10a   | `765886be` | Template renderer foundation in `templates.ts`: `normalizeTemplate`, `buildFormatOrder`, `coalesceRows`, `renderByFormatOrder`, and the canonical `UnformatedPromptSlots` contract.                        |
| 7-10b   | `978ade30` | Content cards: shared `renderContentCard` (persona/description/authornote/lorebook/postEverything/plain/jailbreak/cot/chatML) + `renderByTemplate`; `preflight.ts` now consumes the same builder.          |
| 7-10c   | `0d2e0e17` | Chat cards + systemized chat: `chat` range math + `systemizeChat` lifted into `renderContentCard`; `preflight.ts`'s `chat` case removed (only `memory`/`cache` inline).                                    |
| 7-10d   | `3983d2d0` | Memory cards + cache markers: `memory` (clone + `innerFormat` wrap, no positionParser), explicit `cache` walk-back, and the automatic 3-deep `user` cache point — all in `renderByTemplate`.               |
| 7-10e   | `2871960f` | Prompt-info capture + content trim: `renderByTemplate` returns `{ formated, promptInfo }`, collects the parallel info array via a `deps.promptInfo` sink, and trims both arrays (+ `renderByFormatOrder`). |

What is real in code:

- `server/fastify/src/routes/generationChat.ts` validates request
  bodies and emits `stage(validate)` -> `error` -> `done`; it does
  **not** call `assemble.ts` yet. There is still no
  `/api/v1/generate/preview-prompt` route.
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
- `templates.ts` is no longer a stub. It holds the 7-10a renderer
  foundation, 7-10b content cards, the 7-10c chat/systemized-chat
  path, the 7-10d `memory` / `cache` cards, and the 7-10e prompt-info
  capture + content trim. `renderContentCard` is shared by rendering
  and `preflight.ts`; it returns `null` only for `memory` / `cache`,
  which `renderByTemplate` handles inline (memory builds rows from the
  injected `memories`; explicit `cache` and the automatic 3-deep `user`
  cache point mutate the accumulated `formated`). `renderByTemplate` now
  returns `{ formated, promptInfo }` (`RenderedTemplate`): when both
  `promptInfoInsideChat` and `promptTextInfoInsideChat` are on it
  collects a parallel info array via the `deps.promptInfo` sink, and it
  trims row contents on both the template and (via `renderByFormatOrder`)
  the non-template paths. `preflight.ts` is unchanged — it never
  supplies the sink and still keeps only the `memoryCardUsed` /
  `hasCachePoint` flags.
- `assemble.ts` still throws a Phase 7 not-implemented error. Tier 3
  owns state loading, `triggerResult.additonalSysPrompt` placement,
  final memory/render wiring (including supplying the `memories`
  input), and connecting the chat route to the assembled prompt.

Last recorded baselines after 7-10e:

- `pnpm api:test`: 819 across 40 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: passes with existing CSS / bundle-size warnings

## Next Slice — 7-10f render finalization + request-edit boundary

Pick up **7-10f — render finalization + request-edit boundary**.

7-10e (`2871960f`) added prompt-info capture + the content trim, so each
render path returns trimmed rows (`renderByTemplate` →
`{ formated, promptInfo }`; `renderByFormatOrder` → trimmed rows). 7-10f
adds the remaining tail of the SPA `renderFinalPrompt` and the unifying
top-level entry. SPA reference is `renderFinalPrompt.ts:60-88`,
`:372-396`.

### Scope sketch (SPA reference, `renderFinalPrompt.ts`)

- top-level `renderFinalPrompt(args) -> { formated, promptText }`
  (`:60-396`): the entry that dispatches the template path
  (`renderByTemplate`) vs the non-template path (`renderByFormatOrder`)
  and applies the steps below. This is where the eventual public
  contract lives; Tier 3 calls it.
- `isContinue` pre-push (`:77-88`): when `isContinue` and `aiModel`
  starts with `claude` / `gpt` / `openrouter` / `reverse_proxy`, push
  `{ role: 'system', content: '[Continue the last response]' }` onto
  `unformated.postEverything` **before** the walk.
- `depth_prompt` splice (`:372-382`): when
  `currentChar.depth_prompt?.prompt?.length > 0`, splice a
  `{ role: 'system', content: <expanded prompt> }` row in at
  `formated.length - depth_prompt.depth`. Runs **after** the 7-10e trim,
  so it lives in the top-level, not inside the path renderers.
- `editRequest` Lua handoff (`:384`, `:387-393`):
  `runLuaEditTrigger(currentChar, 'editRequest', formated)` (and the
  same over `promptInfo` to produce `promptText`). Browser Lua
  execution stays deferred (plugin/Lua boundary) — port this as a
  pass-through seam that 7-11b / dispatch and the 7-9e request-state
  transform plug into.

### Important structural note

The trim already happens inside `renderByTemplate` / `renderByFormatOrder`
(7-10e), and `depth_prompt` must run **after** it, so the splice belongs
in the new top-level `renderFinalPrompt`, not back in the path
renderers. Keep the path renderers as-is and layer the finalization on
top. The `editRequest` seam should be a no-op-by-default function
(identity transform) so the server build never pulls in browser Lua;
Tier 3 / the dispatch layer supplies the real transform.

### Out of scope (defer)

- Real browser Lua `editRequest` execution (stays with plugin/Lua).
- The assemble root that builds the injection-lore-aware
  `positionParser`/`resolvePosition`, loads state, applies
  `triggerResult.additonalSysPrompt`, and wires the chat route — Tier 3
  (7-11a onward).

### Verification

```bash
pnpm check
pnpm api:test
pnpm test
pnpm build
```

7-10f is the default next pickup and closes the template renderer; then
the Tier 3 root/route wiring (7-11a onward) begins.

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
