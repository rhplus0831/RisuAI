# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `5aae492b feat: ableFlag <order, actions> DSL + outScript prep (Phase 7-6c)`

This is the short runbook for picking up **Phase 7 in progress**.
Phases 0-6 are closed. The detailed Phase 7 roadmap lives in
[`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md);
this file only records the current handoff state and the next slice.

## Current State

Landed Phase 7 slices:

| Slice | Commit     | Summary                                                                                                                      |
| ----- | ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine prompt SSE event names, and added prompt module shells.  |
| 7-2a  | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                              |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                                |
| 7-2c  | `7ed156e6` | Wired the server parser adapter: `promptScope.ts`, `cbsAdapter.ts`, `promptVariablesBoot.ts`, and real `expandVariables`.    |
| 7-3   | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                      |
| 7-4   | `051a5dcd` | Ported plain prompt sections: main, jailbreak, and global note.                                                              |
| docs  | `e7a76f32` | Organized the remaining Phase 7 roadmap into tiers.                                                                          |
| 7-5a  | `c44e53fc` | Ported the minimal history walk: examples, start-new-chat marker, first message, makeMs filter, per-message role mapping.    |
| 7-6a  | `9a60380d` | Ported the minimal regex script processor: preset+character regex chain, mode filter, flag sanitization, CBS in replacement. |
| 7-5b  | `7ad226b9` | Added per-message scripts + sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill on the history walk.             |
| 7-6b  | `8414d5c7` | Added scripts `@@`-action prefixes: `@@emo` (no-op), `@@inject`, `@@move_top`, `@@move_bottom`, `@@repeat_back`.             |
| 7-6c  | `5aae492b` | Added `ableFlag <order, actions>` DSL, `cbs`/`no_end_nl` actions, outScript prep, and SPA-parity flag defaults.              |

What is real in code:

- `server/fastify/src/routes/generationChat.ts` validates request
  bodies and emits `stage(validate)` -> `error` -> `done`; it does
  **not** call `assemble.ts` yet.
- `server/fastify/src/prompt/sseEvents.ts`,
  `variables.ts`, `staticSections.ts`, `plainSections.ts`,
  `history.ts` (deterministic walk + per-message scripts +
  sendName wrapper + `<Thoughts>` extraction + memo/UUID
  backfill), and `scripts.ts` (regex chain + five `@@`-action
  prefixes + `ableFlag` `<order, actions>` DSL + `cbs` /
  `no_end_nl` actions + outScript prep + SPA-parity flag
  defaults) are implemented and tested.
- `assemble.ts`, `lorebook.ts`, `templates.ts`, `tokens.ts`, and
  `triggers.ts` still throw Phase 7 not-implemented errors.
- `history.ts` does not yet handle multimodal inlays,
  `{{asset_prompt::}}`, start triggers, tokenizer accumulation, or
  depth prompts (7-5c/d/e).
- `scripts.ts` does not yet handle module regex scripts,
  script-cache, `runLuaEditTrigger`, `runTrigger('display', …)`,
  or `pluginV2` hooks (7-6d/e).
- There is no `/api/v1/generate/preview-prompt` route yet.

Last recorded baselines after 7-6c:

- `pnpm api:test`: 557 across 33 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean

## Next Slice

Pick up **7-6d - module regex scripts**.

The SPA's `processScriptFull` extends the script chain with
`getModuleRegexScripts()` (`scripts.ts:161`), which walks the
enabled modules and concatenates their `regex` arrays. Server
needs to read the active module list from the database snapshot.

Slice scope:

- Add a helper that mirrors `modules.ts:381-405`
  `getModules()`: derives the active module id list from
  `db.enabledModules`, `currentChat.modules`,
  `currentChar.modules`, and `db.moduleIntergration` (comma list),
  then filters `db.modules` by `id` or `namespace` match and
  dedupes by id. Skip the SPA's lastModules / lastModuleData
  memoization (server runs once per assembly).
- Add `getModuleRegexScripts(modules)` returning the concatenated
  `regex[]` from each module (`modules.ts:454-466`).
- Wire `processScript` to concat
  `presetRegex` -> `char.customscript` -> module regex into one
  script list before parsing the `ableFlag` DSL. The ordering
  matters: presets first, then character, then modules.

Skip-list (defer to 7-6e or beyond):

- `module.trigger` / `module.lorebook` / `module.assets` / `module.cjs`
  (their consumers ship in 7-5c, 7-7, 7-9).
- script-cache (`generateScriptCacheKey` / `getScriptCache` /
  `cacheScript`): pure optimization; the server runs each script
  chain fresh per assembly. Revisit if profiling shows a hot path.
- `runTrigger('display', …)` for `editdisplay` mode: blocked on
  Triggers (7-9).
- `runLuaEditTrigger`, `pluginV2[mode]`: browser-only.

Other Tier 1 candidates remain unblocked: **7-5c** (multimodal
inlays + `{{asset_prompt::}}`; the assets path benefits from a
clearer request-body inlay payload interface that Tier 3 will
shape - reasonable to wait) and **7-7a** (constant lorebook; the
SPA orchestrator still doesn't slice cleanly without porting the
decorator system first - revisit).

Same rhythm: boot prompt-variable infra in tests with
`beforeAll(() => bootPromptVariables())`, small database
fixtures, and run all four bars (`pnpm check`, `pnpm api:test`,
`pnpm test`, `pnpm build`) before reporting back.

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
