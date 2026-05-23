# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `652a0edf docs: check phase 7`

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
| 7-7b  | `25388d7d` | Added lorebook keyword matching: `searchMatch` port, child mirror, conditional-activation decorators, and `matchLog`.        |
| 7-7c  | `b11902ad` | Added lorebook recursive activation: `while (matching)` loop, `recursivePrompt` accumulation, three recursion decorators.    |
| 7-7e  | `c0f3fb3a` | Added lorebook depth-prompt helpers: `getDepthPrompts`, `resolvePosition`, and `applyDepthPrompts` history splicer.          |

What is real in code:

- `server/fastify/src/routes/generationChat.ts` validates request
  bodies and emits `stage(validate)` -> `error` -> `done`; it does
  **not** call `assemble.ts` yet.
- `server/fastify/src/prompt/sseEvents.ts`,
  `variables.ts`, `staticSections.ts`, `plainSections.ts`,
  `history.ts` (deterministic walk + per-message scripts +
  sendName wrapper + `<Thoughts>` extraction + memo/UUID backfill,
  multimodal inlays, `{{asset_prompt::}}`, and the `applyDepthPrompts`
  splicer from 7-7e), `scripts.ts` (full SPA-parity regex chain:
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
- `assemble.ts`, `templates.ts`, `tokens.ts`, and `triggers.ts`
  still throw Phase 7 not-implemented errors.
- `history.ts` does not yet handle start triggers or tokenizer
  accumulation (7-5d/e).
- `scripts.ts` does not yet handle script-cache,
  `runLuaEditTrigger`, `runTrigger('display', …)`, or `pluginV2`
  hooks — all 7-6e or out-of-scope.
- `lorebook.ts` covers the full activation surface (constant
  / keyword / recursive / depth-prompt). The only deferred
  lorebook slice is 7-7d (budget-aware truncation), blocked on
  Tokens (7-8a) for the real per-entry `tokens` field.
- There is no `/api/v1/generate/preview-prompt` route yet.

Last recorded baselines after 7-7e, unchanged by the latest docs-only
check:

- `pnpm api:test`: 640 across 35 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: passes with existing CSS / bundle-size warnings

## Next Slice — 7-8a server tokenizer

Pick up **7-8a — server tokenizer**.

The lorebook activation/depth chain is at a clean handoff: only
7-7d remains, and it needs a real per-entry `tokens` field on
`LoreEntryActive`. The same minimal tokenizer also unblocks 7-5e
history token accumulation and depth-prompt token preflight. The
broader 7-8b/c work is still template-wide preflight and final
budget pruning; do not let it expand 7-8a.

### Scope

- Rewrite `server/fastify/src/prompt/tokens.ts`; the current file is
  still a throwing stub.
- Add `server/fastify/__tests__/tokens.test.ts`.
- Export `TokenEncoding`, `encodingForModel`, `tokenize`,
  `tokenizeChat`, and `tokenizeChats`.
- Use `@dqbd/tiktoken` with `cl100k_base` / `o200k_base` and a
  module-scope encoder cache. Keep the API synchronous.
- Route `gpt-4o`, `gpt-4.1`, `gpt-5`, `o1`, `o3`, `o4`, and
  `gpt-oss` families to `o200k_base`; default everything else to
  `cl100k_base`. Cross-check the exact prefix list against
  `LLMTokenizer.tiktokenO200Base` rows in `src/ts/model/modellist.ts`.
- Count text-only chat messages: content + default per-message
  overhead 4, optional `name`, and optional `thoughts`.

Out of scope for 7-8a: the full 654-line browser tokenizer
dispatcher, Svelte stores, plugin/custom tokenizers,
`@mlc-ai/web-tokenizers`, Google remote count-token calls, local
GGUF tokenization, exact provider tokenizers, and multimodal
image-token math. Document the conservative `cl100k_base` fallback
in `tokens.ts`; exact provider tokenizers should land only when a
fixture needs them.

### Tests

Add isolated server tests for:

- `encodingForModel` on `gpt-4o`, `gpt-4`, a Claude fallback, and
  `undefined`.
- `tokenize('')` and one hardcoded `hello world` oracle captured
  from a one-off tiktoken run.
- `tokenizeChat` content overhead, `name`, `thoughts`, and
  `tokenizeChats` summing.

Expected `pnpm api:test` count after the slice: **640 -> ~649**.
Still run all four bars before closeout:

```bash
pnpm check
pnpm api:test
pnpm test
pnpm build
```

### After 7-8a Lands

- Backfill HANDOVER, ROADMAP, the Phase 7 doc, and
  `status/next-steps.md` with the real SHA.
- Flip the next default slice to **7-7d lorebook budget filter**.
  After 7-7d, pick up **7-5e history tokenizer + depth prompts**
  before returning to 7-8b/c.
- If the tiktoken import path itself blocks the slice, defer to
  **7-9a trigger sandbox** or **7-10a template card parsing**.

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
