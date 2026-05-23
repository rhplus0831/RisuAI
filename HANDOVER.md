# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `faec5145 feat: V2 trigger safe data helpers (Phase 7-9d-ii)`

The strategic view of remaining Phase 7 slices lives in
[`ROADMAP.md`](ROADMAP.md). This file stays as the day-to-day
handoff with the current head, baselines, and the next pickup.

This is the short runbook for picking up **Phase 7 in progress**.
Phases 0-6 are closed. The detailed Phase 7 roadmap lives in
[`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md);
this file only records the current handoff state and the next slice.

## Current State

Landed Phase 7 slices:

| Slice   | Commit     | Summary                                                                                                                                   |
| ------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1     | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine prompt SSE event names, and added prompt module shells.               |
| 7-2a    | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                                           |
| 7-2b    | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                                             |
| 7-2c    | `7ed156e6` | Wired the server parser adapter: `promptScope.ts`, `cbsAdapter.ts`, `promptVariablesBoot.ts`, and real `expandVariables`.                 |
| 7-3     | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                                   |
| 7-4     | `051a5dcd` | Ported plain prompt sections: main, jailbreak, and global note.                                                                           |
| docs    | `e7a76f32` | Organized the remaining Phase 7 roadmap into tiers.                                                                                       |
| 7-5a    | `c44e53fc` | Ported the minimal history walk: examples, start-new-chat marker, first message, makeMs filter, per-message role mapping.                 |
| 7-6a    | `9a60380d` | Ported the minimal regex script processor: preset+character regex chain, mode filter, flag sanitization, CBS in replacement.              |
| 7-5b    | `7ad226b9` | Added per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill on the history walk.                          |
| 7-6b    | `8414d5c7` | Added scripts `@@`-action prefixes: `@@emo` (no-op), `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`.                          |
| 7-6c    | `5aae492b` | Added `ableFlag <order, actions>` DSL, `cbs`/`no_end_nl` actions, outScript prep, and SPA-parity flag defaults.                           |
| 7-6d    | `cb5675d8` | Wired module regex scripts into the script chain via new `getActiveModules` + `getModuleRegexScripts` helpers.                            |
| 7-5c    | `50a1770b` | Added history multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module asset triples.                                           |
| 7-7a    | `c815e067` | Ported lorebook constant (always-on) entries with the in-scope decorator scaffold and `inject_lore` rewrites.                             |
| 7-7b    | `25388d7d` | Added lorebook keyword matching: `searchMatch` port, child mirror, conditional-activation decorators, and `matchLog`.                     |
| 7-7c    | `b11902ad` | Added lorebook recursive activation: `while (matching)` loop, `recursivePrompt` accumulation, three recursion decorators.                 |
| 7-7e    | `c0f3fb3a` | Added lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.                       |
| 7-8a    | `17fca64f` | Minimal server tokenizer: `encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats` over `cl100k_base` / `o200k_base`.              |
| 7-7d    | `f0382df8` | Lorebook budget-aware truncation: per-entry `tokens`, priority-desc filter, `loreSettings.tokenBudget` resolution.                        |
| 7-5e    | `febe67ce` | History `addedTokens` accumulator + depth-prompt token preflight when a `LorebookActivationReport` is supplied.                           |
| 7-8b    | `d488ab7f` | Template-wide token preflight: `preflightTemplateTokens` walks the card list, returning `{ addedTokens, memoryCardUsed, hasCachePoint }`. |
| 7-8c    | `c83015b3` | Request budget finalization: `finalizeRequestBudget` trims `removable` rows under `maxContextTokens` and clamps `outputTokens`.           |
| 7-9a    | `cddc035e` | Trigger model + runner shell: `getModuleTriggers`, `collectTriggers`, `matchesTrigger`, and the `runTrigger` shell (no effect execution). |
| 7-9b    | `cb23202b` | Trigger variables + conditions: `createTriggerVarEngine`, `evaluateConditions`, context/result extension, `parseKeyValue` lift.           |
| 7-9c    | `cae61155` | Deterministic V1 effects: `setvar`, `systemprompt`, `impersonate`, `stop`, `cutchat`, `modifychat`, bounded `runtrigger` recursion.       |
| 7-9d-i  | `1bd8313b` | V2 control-flow core: index-based loop, `v2If`/`v2Else`/`v2EndIndent`/loops/`v2BreakLoop`, `v2SetVar`, `v2RunTrigger`, V2 state effects.  |
| 7-9d-ii | `faec5145` | V2 safe data helpers in `triggerDataEffects.ts`: message readers, string/array/dict/math, random, tokenize, regex, quick search.          |

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
- `modules.ts` also exports `getModuleTriggers` (7-9a), which
  aggregates active-module trigger scripts with inherited
  `lowLevelAccess`, cloning each entry instead of mutating the
  module's trigger objects in place.
- `triggers.ts` now hosts the Svelte-free trigger model + runner
  shell (7-9a) plus the variable/condition engine (7-9b):
  `TriggerMode` / `TriggerRunContext` (now carries `database` /
  `selectedCharID` / `chatPage`) / `TriggerRunArg` /
  `TriggerRunResult` (now carries `varChanged`) types,
  `collectTriggers` (character + module triggers, cloned with
  inherited `lowLevelAccess`), `matchesTrigger` (mode/manual-name
  filter + `triggercode`/`triggerlua` bypass), `evaluateConditions`
  (`var` / `value` / `chatindex` / `exists`, all operators, expanded
  via `expandVariables`), and `runTrigger` (input cloning, no-trigger
  `null` return, recursion / trigger-id threading, default-variable +
  var-engine construction, per-trigger condition evaluation, the
  deterministic V1 effect arms from 7-9c, and terminal token
  accounting).
- The 7-9c V1 effect arms in `runTrigger`: `setvar` (numeric ops via
  the var engine), `systemprompt` (slot accumulation feeding the
  token count), `impersonate` / `cutchat` / `modifychat` (chat-message
  edits on the returned `result.chat`), `stop` (`stopSending`), and
  bounded `runtrigger` recursion (`recursiveCount < 10` unless
  `lowLevelAccess`, threading `ctx` through the recursive call and
  OR-ing recursive `varChanged`). The effect-loop scaffold tracks
  `currentIndent` via `engine.setIndent`.
- The 7-9d-i V2 control-flow core: the effect loop is index-based so
  V2 flow can advance/rewind `index`. Arms: `v2Header` / `v2Comment`
  / `v2ConsoleLog` (no-ops), `v2SetVar` (`%=`), `v2DeclareLocalVar`,
  `v2If` / `v2IfAdvanced` (`∈` / `∋` / `∌` / `≒` / `≡` operators +
  fail-skip), `v2Else`, `v2EndIndent` (loop-back + lag guard +
  `clearLocalVarsAtIndent`), `v2Loop` / `v2LoopNTimes`, `v2BreakLoop`,
  `v2StopTrigger`, `v2StopPromptSending`, bounded `v2RunTrigger`
  (`effect.target`), and the V2 state effects `v2CutChat` /
  `v2ModifyChat` / `v2SystemPrompt` / `v2Impersonate`.
- `triggerDataEffects.ts` (7-9d-ii) exports `applyV2DataEffect`,
  dispatched from `runTrigger`'s switch `default`: the side-effect-free
  V2 leaf arms — message readers, string ops, array helpers
  (JSON-in-var), dict helpers (JSON-in-var), `v2Random`, `v2Calculate`
  (via the Svelte-free `calcString`), `v2Tokenize` (via `tokens.ts`),
  `v2RegexTest`, and `v2QuickSearchChat`. Each is `resolve → compute →
engine.setVar(outputVar)`; the `v2MakeArrayVar`/`v2MakeDictVar`/
  `v2ClearDict` malformed-name guard is a handled no-op (the SPA's
  `return` aborts the whole run). Deferred arms (`command`, the
  `lowLevelAccess`-gated alert/LLM/image/similarity, request/display
  state (7-9e), the persistent lorebook/character/persona/note arms,
  GUI/wait, `triggercode`/`triggerlua`) fall through to `false`.
- `triggerVars.ts` (7-9b) exports `createTriggerVarEngine`: the
  ported `getVar` / `setVar`, local-variable scope stack
  (`declareLocalVar` / `setLocalVar` / `clearLocalVarsAtIndent`),
  `displayMode` `tempVars` fallback, `varChanged` tracking, and
  `setChat` (7-9c repoints the engine after a `runtrigger` chat
  reassignment). `setVar` persists into the single `database` snapshot
  (the SPA's three-store sync + `ReloadGUIPointer` bump are dropped).
- `parseKeyValue` was lifted into `src/ts/util/parseKeyValue.ts`
  (Svelte-free) and re-exported from `src/ts/util.ts` (7-9b), so the
  trigger path resolves default variables without pulling in Svelte
  (mirrors the `loreHash` lift).
- `tokens.ts` now exports the minimal server tokenizer
  (`encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats`)
  over `cl100k_base` / `o200k_base` with a module-scope encoder
  cache (Phase 7-8a).
- `preflight.ts` runs the template-wide token preflight
  (`preflightTemplateTokens`), returning `{ addedTokens,
memoryCardUsed, hasCachePoint }` and the
  `PromptUnformatedSlots` shape the future assemble root will
  feed in (Phase 7-8b).
- `budgetFinalize.ts` runs the final request budget step
  (`finalizeRequestBudget`): re-tokenizes a flattened
  `OpenAIChat[]`, trims `removable` rows under `maxContextTokens`,
  drops emptied non-multimodal rows, and clamps `outputTokens`,
  returning `{ ok, formated, inputTokens, outputTokens }` or
  `{ ok: false, reason: 'overflow' }` (Phase 7-8c).
- `tokenizerConfig.ts` houses the shared `tokenizerOptionsFromDb`
  helper used by `history.ts` (7-5e), `preflight.ts` (7-8b), and
  `budgetFinalize.ts` (7-8c).
- `assemble.ts` and `templates.ts` still throw Phase 7
  not-implemented errors. `triggers.ts` is now a real runner with the
  variable/condition engine, deterministic V1 effects, and the full V2
  dialect (control flow + safe data helpers) wired (7-9a/b/c/d); only
  the request/display adapters (7-9e) and the start-trigger handoff
  (7-9f) remain on the trigger front.
- `history.ts` does not yet handle start triggers (7-5d, blocked
  on 7-9f after the trigger re-scope). 7-5e (`febe67ce`) landed the
  `addedTokens` accumulator + depth-prompt preflight; the only remaining
  history gap is the start-trigger token contribution.
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

Last recorded baselines after 7-9d-ii:

- `pnpm api:test`: 761 across 39 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: passes with existing CSS / bundle-size warnings

## Next Slice — 7-9e request/display state adapters

Pick up **7-9e — request/display state adapters**.

7-9d-ii (`faec5145`) closed the V2 data-helper batch. 7-9e adds the
mode allowlists plus the request/display state arms, which read and
write the per-run **display text** (`arg.displayData`) or a
JSON-stringified **`OpenAIChat[]`** request state carried in the same
`displayData` slot. This is the last trigger sub-slice before 7-9f
(the `start` handoff). **7-10a** (template normalization and slot
contract) remains an equally valid parallel pickup.

### Scope sketch (SPA reference, `triggers.ts`)

- The effect-loop allowlist guards deferred from 7-9c/d-i
  (`:1444-1449`): port `displayAllowList` (`:1137`) and
  `requestAllowList` (`:1139`) plus the shared `safeSubset` they
  spread, and skip non-allowlisted effects when `mode === 'display'`
  / `mode === 'request'`.
- Display state: `v2GetDisplayState` (`:2695`) reads `arg.displayData`;
  `v2SetDisplayState` (`:2703`) writes it. Both gate on
  `arg.displayMode`.
- Request state over `JSON.parse(arg.displayData) as OpenAIChat[]`:
  `v2GetRequestState` / `v2SetRequestState` (`content`, `:2732`/`:2745`),
  `v2GetRequestStateRole` / `v2SetRequestStateRole` (validated to
  `user`/`assistant`/`system`, `:2762`/`:2775`),
  `v2GetRequestStateLength` (`:2795`).
- Plumbing: these arms mutate `arg.displayData`; thread a mutable
  display-data holder through the run so the returned `displayData`
  reflects the writes (the result already surfaces `displayData`).
  Decide how the non-`displayMode` early-`return` should map (same
  abort-the-run quirk as the 7-9d-ii make-var guard — likely a handled
  no-op).

### Tests

Extend `__tests__/triggers.test.ts`: a `display`-mode run where
`v2SetDisplayState` then `v2GetDisplayState` round-trip text; a
request-state run that reads/writes a row's `content` and `role` over
an `OpenAIChat[]` payload and reports the length; and an allowlist
check that a non-allowlisted effect is skipped in display/request
mode.

### Out of scope (defer)

- `start` trigger history handoff — 7-9f (consumed by 7-5d).
- Input hook adapter — 7-9g only if Phase 7 needs it before Phase 9.
- V2 low-level arms (alert/LLM/image/similarity, persona/character/
  lorebook mutation, GUI/update) and `command` — deferred beyond
  Phase 7 per the roadmap boundary.

### Verification

```bash
pnpm check
pnpm api:test
pnpm test
pnpm build
```

If 7-9e is blocked, the parallel next-up is **7-10a** (template
normalization + slot contract).

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
