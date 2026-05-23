# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `cddc035e feat: trigger model + runner shell (Phase 7-9a)`

The strategic view of remaining Phase 7 slices lives in
[`ROADMAP.md`](ROADMAP.md). This file stays as the day-to-day
handoff with the current head, baselines, and the next pickup.

This is the short runbook for picking up **Phase 7 in progress**.
Phases 0-6 are closed. The detailed Phase 7 roadmap lives in
[`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md);
this file only records the current handoff state and the next slice.

## Current State

Landed Phase 7 slices:

| Slice | Commit     | Summary                                                                                                                                   |
| ----- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine prompt SSE event names, and added prompt module shells.               |
| 7-2a  | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                                           |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                                             |
| 7-2c  | `7ed156e6` | Wired the server parser adapter: `promptScope.ts`, `cbsAdapter.ts`, `promptVariablesBoot.ts`, and real `expandVariables`.                 |
| 7-3   | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                                   |
| 7-4   | `051a5dcd` | Ported plain prompt sections: main, jailbreak, and global note.                                                                           |
| docs  | `e7a76f32` | Organized the remaining Phase 7 roadmap into tiers.                                                                                       |
| 7-5a  | `c44e53fc` | Ported the minimal history walk: examples, start-new-chat marker, first message, makeMs filter, per-message role mapping.                 |
| 7-6a  | `9a60380d` | Ported the minimal regex script processor: preset+character regex chain, mode filter, flag sanitization, CBS in replacement.              |
| 7-5b  | `7ad226b9` | Added per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill on the history walk.                          |
| 7-6b  | `8414d5c7` | Added scripts `@@`-action prefixes: `@@emo` (no-op), `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`.                          |
| 7-6c  | `5aae492b` | Added `ableFlag <order, actions>` DSL, `cbs`/`no_end_nl` actions, outScript prep, and SPA-parity flag defaults.                           |
| 7-6d  | `cb5675d8` | Wired module regex scripts into the script chain via new `getActiveModules` + `getModuleRegexScripts` helpers.                            |
| 7-5c  | `50a1770b` | Added history multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module asset triples.                                           |
| 7-7a  | `c815e067` | Ported lorebook constant (always-on) entries with the in-scope decorator scaffold and `inject_lore` rewrites.                             |
| 7-7b  | `25388d7d` | Added lorebook keyword matching: `searchMatch` port, child mirror, conditional-activation decorators, and `matchLog`.                     |
| 7-7c  | `b11902ad` | Added lorebook recursive activation: `while (matching)` loop, `recursivePrompt` accumulation, three recursion decorators.                 |
| 7-7e  | `c0f3fb3a` | Added lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.                       |
| 7-8a  | `17fca64f` | Minimal server tokenizer: `encodingForModel`, `tokenize`, `tokenizeChat`, `tokenizeChats` over `cl100k_base` / `o200k_base`.              |
| 7-7d  | `f0382df8` | Lorebook budget-aware truncation: per-entry `tokens`, priority-desc filter, `loreSettings.tokenBudget` resolution.                        |
| 7-5e  | `febe67ce` | History `addedTokens` accumulator + depth-prompt token preflight when a `LorebookActivationReport` is supplied.                           |
| 7-8b  | `d488ab7f` | Template-wide token preflight: `preflightTemplateTokens` walks the card list, returning `{ addedTokens, memoryCardUsed, hasCachePoint }`. |
| 7-8c  | `c83015b3` | Request budget finalization: `finalizeRequestBudget` trims `removable` rows under `maxContextTokens` and clamps `outputTokens`.           |
| 7-9a  | `cddc035e` | Trigger model + runner shell: `getModuleTriggers`, `collectTriggers`, `matchesTrigger`, and the `runTrigger` shell (no effect execution). |

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
  shell (7-9a): `TriggerMode` / `TriggerRunContext` / `TriggerRunArg`
  / `TriggerRunResult` types, `collectTriggers` (character + module
  triggers, cloned with inherited `lowLevelAccess`), `matchesTrigger`
  (mode/manual-name filter + `triggercode`/`triggerlua` bypass), and
  `runTrigger` (input cloning, no-trigger `null` return, recursion /
  trigger-id threading via explicit context, a no-op selected-trigger
  seam for 7-9b/c/d, and terminal additional-system-prompt token
  accounting + return shape). It executes **no** conditions or
  effects yet.
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
  not-implemented errors. `triggers.ts` is now a real (effect-free)
  runner shell (7-9a).
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

Last recorded baselines after 7-9a:

- `pnpm api:test`: 720 across 39 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: passes with existing CSS / bundle-size warnings

## Next Slice — 7-9b trigger variables + conditions

Pick up **7-9b — variable and condition engine**.

7-9a (`cddc035e`) landed the trigger model + runner shell:
`getModuleTriggers` / `collectTriggers` / `matchesTrigger` and the
effect-free `runTrigger` shell. The selected-trigger loop in
`runTrigger` is an explicit `// 7-9b/c/d` seam — it currently does
nothing per matched trigger. 7-9b fills in the variable/condition
half of that seam so 7-9c can then dispatch effects against real
variable state.

7-9b should stay Svelte-free and read/write state through the
explicit `TriggerRunContext` (extended this slice), never through
`getDatabase()` / `getCurrentChat()` / `CurrentTriggerIdStore`.
**7-10a** (template normalization + slot contract) remains an
equally valid parallel pickup if you'd rather start the template
front.

### Scope sketch (SPA reference)

- Port default-variable lookup (`parseKeyValue(char.defaultVariables)`
  concat `parseKeyValue(db.templateDefaultVariables)`,
  `triggers.ts:1204-1206`).
- Port the `getVar` / `setVar` pair (`triggers.ts:1295-1338`): chat
  `scriptstate['$'+key]` read/write, the local-variable scope stack
  (`getLocalVar` / `setLocalVar` / `declareLocalVar` /
  `clearLocalVarsAtIndent`, `triggers.ts:1224-1293`), `displayMode`
  `tempVars` fallback, and the `varChanged` flag.
- Extend `TriggerRunContext` with the `database` / `currentChar` /
  `currentChat` scope `setVar` persists into (replacing the SPA's
  `getCurrentChat()` / `getCurrentCharacter()` / `getDatabase()` /
  `selectedCharID` writes). No `ReloadGUIPointer` store write — that
  stays browser-side.
- Port condition evaluation (`triggers.ts:1353-1460`): `var` /
  `value` / `chatindex` comparisons through `risuChatParser`, the
  `=` / `!=` / `>` / `<` / `>=` / `<=` / `null` / `true` operators,
  and the `exists` condition with `strict` / `loose` / `regex`
  matching at a given depth.
- Thread `trigger_id` through the explicit context for the condition
  parser, not `CurrentTriggerIdStore`.

### Tests

Extend `__tests__/triggers.test.ts`: default-variable fallback,
`scriptstate` read/write + `varChanged`, local-scope shadowing and
`clearLocalVarsAtIndent`, `displayMode` `tempVars` isolation, each
condition operator, and `exists` strict/loose/regex. Effect
execution still belongs to 7-9c/d.

### Out of scope (defer)

- Deterministic V1 effects — 7-9c.
- V2 safe control-flow/data effects — 7-9d.
- Request/display state adapters — 7-9e.
- `start` trigger history handoff — 7-9f (consumed by 7-5d).
- Input hook adapter — 7-9g only if Phase 7 needs it before Phase 9.
- Browser-only plugin / Lua execution and low-level side effects —
  stay deferred per the roadmap boundary.

### Verification

```bash
pnpm check
pnpm api:test
pnpm test
pnpm build
```

If 7-9b is blocked, the parallel next-up is **7-10a** (template
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
