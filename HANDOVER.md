# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `c815e067 feat: lorebook constant entries (Phase 7-7a)`

The strategic view of remaining Phase 7 slices lives in
[`ROADMAP.md`](ROADMAP.md). This file stays as the day-to-day
handoff with the current head, baselines, and the next pickup.

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
| 7-6d  | `cb5675d8` | Wired module regex scripts into the script chain via new `getActiveModules` + `getModuleRegexScripts` helpers.               |
| 7-5c  | `50a1770b` | Added history multimodal inlays, `{{asset_prompt::}}`, `AssetLookup`, and module asset triples.                              |
| 7-7a  | `c815e067` | Ported lorebook constant (always-on) entries with the in-scope decorator scaffold and `inject_lore` rewrites.                |

What is real in code:

- `server/fastify/src/routes/generationChat.ts` validates request
  bodies and emits `stage(validate)` -> `error` -> `done`; it does
  **not** call `assemble.ts` yet.
- `server/fastify/src/prompt/sseEvents.ts`,
  `variables.ts`, `staticSections.ts`, `plainSections.ts`,
  `history.ts` (deterministic walk + per-message scripts +
  sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill,
  multimodal inlays, and `{{asset_prompt::}}`), `scripts.ts` (full
  SPA-parity regex chain: preset + character + module regex,
  `@@`-actions, `ableFlag` DSL, `cbs` / `no_end_nl` actions,
  outScript prep), `modules.ts` (`getActiveModules` +
  `getModuleRegexScripts` + `getModuleAssets`), and `lorebook.ts`
  (constant entries + in-scope decorator parser + `inject_lore`
  rewrites + `disabledUIPrompts`) are implemented and tested.
- `assemble.ts`, `templates.ts`, `tokens.ts`, and `triggers.ts`
  still throw Phase 7 not-implemented errors.
- `history.ts` does not yet handle start triggers, tokenizer
  accumulation, or depth prompts (7-5d/e).
- `scripts.ts` does not yet handle script-cache,
  `runLuaEditTrigger`, `runTrigger('display', …)`, or `pluginV2`
  hooks — all 7-6e or out-of-scope.
- `lorebook.ts` covers always-on activation only; keyword
  matching (7-7b), recursion (7-7c), budget truncation (7-7d),
  and depth-prompt emission into history (7-7e) are deferred.
  The decorator callback's `default: return false` leaves
  unimplemented decorators (`additional_keys`, `recursive`,
  `activate_only_after`, `probability`, etc.) literal in the
  prompt text until their slice lands.
- There is no `/api/v1/generate/preview-prompt` route yet.

Last recorded baselines after 7-7a:

- `pnpm api:test`: 598 across 35 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: passes with existing CSS / bundle-size warnings

## Next Slice

Pick up **7-7b - lorebook keyword matching activation**.

`lorebook.ts` now handles always-on entries plus the decorator
scaffold. 7-7b layers keyword matching on top: scan the last
`scanDepth` messages of `currentChat.message` (default
`loreBookDepth` 5) for the entry's `key` (comma-separated, also
`secondkey`/`selective` for AND-matching), honor `useRegex`, and
add the conditional-activation decorators that 7-7a punted to
`default: return false`.

Slice scope:

- Port `searchMatch` from
  `src/ts/process/lorebook.svelte.ts:97-239` for the
  non-recursive, single-pass case (no `recursivePrompt` yet).
- Activate decorators: `additional_keys`, `exclude_keys`,
  `exclude_keys_all`, `match_full_word`, `match_partial_word`,
  `scan_depth`, `activate_only_after`, `activate_only_every`,
  `is_greeting`, `probability`, `activate`, `dont_activate`,
  `keep_activate_after_match`, `dont_activate_after_match`
  (the last two read/write via the existing `chatVar`
  backend — `bootPromptVariables` in test setup covers that).
- Resolve `mode === 'child'` mirroring against the previous
  parent entry in the iteration.
- Extend the report with `matchLog` (`{ prompt, source,
activated }`).
- Cover: single-key hit, comma-list, regex key, secondkey AND,
  scan_depth limit, additional_keys / exclude_keys, full-word
  vs partial-word, child mirror, and `activate_only_after`.

Skip-list (still deferred):

- Recursive activation loop (7-7c).
- Token-budget truncation (7-7d).
- Depth-prompt emission for history (7-7e).

Same rhythm: small database fixtures, `beforeAll(() =>
bootPromptVariables())` for the chat-var decorators, and run
all four bars (`pnpm check`, `pnpm api:test`, `pnpm test`,
`pnpm build`) before reporting back.

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
