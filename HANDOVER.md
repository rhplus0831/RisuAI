# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `7ad226b9 feat: per-message scripts + sendName + Thoughts (Phase 7-5b)`

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

What is real in code:

- `server/fastify/src/routes/generationChat.ts` validates request
  bodies and emits `stage(validate)` -> `error` -> `done`; it does
  **not** call `assemble.ts` yet.
- `server/fastify/src/prompt/sseEvents.ts`,
  `variables.ts`, `staticSections.ts`, `plainSections.ts`,
  `history.ts` (deterministic walk + per-message scripts +
  sendName wrapper + `<Thoughts>` extraction + memo/UUID
  backfill), and `scripts.ts` (regex-only `processScript`) are
  implemented and tested.
- `assemble.ts`, `lorebook.ts`, `templates.ts`, `tokens.ts`, and
  `triggers.ts` still throw Phase 7 not-implemented errors.
- `history.ts` does not yet handle multimodal inlays,
  `{{asset_prompt::}}`, start triggers, tokenizer accumulation, or
  depth prompts (7-5c/d/e).
- `scripts.ts` does not yet handle special action prefixes
  (`@@emo`, `@@move_top`, `@@move_bottom`, `@@inject`,
  `@@repeat_back`), the `ableFlag` `<order, actions>` DSL,
  script-cache, `runLuaEditTrigger`, `runTrigger('display', …)`,
  `pluginV2` hooks, or module regex scripts (7-6b/c/d/e).
- There is no `/api/v1/generate/preview-prompt` route yet.

Last recorded baselines after 7-5b:

- `pnpm api:test`: 529 across 33 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean

## Next Slice

Pick up **7-6b - scripts special action prefixes**.

`scripts.ts` currently only honors the plain regex branch. Port
the four deterministic special-action prefixes that the SPA's
`executeScript` recognizes (`scripts.ts:218-325`):

- `@@move_top` / `@@move_bottom` — extract matched text via
  `data.matchAll(reg)`, rewrite with the SPA's `$1` / `$&` / `$<n>`
  substitution helper, then re-prepend or append to `data`.
- `@@inject` — mutate the message at `chatID` in place
  (writes `currentChat.message[chatID].data = data`) and strip
  the matched text from `data`. Server signature accepts an
  optional `chatID` like the SPA.
- `@@repeat_back` — read the previous same-role message body,
  copy its first match to the current `data` (positions: bare,
  `end`, `start`, `end_nl`, `start_nl`).

`@@emo` stays as a no-op on the server (browser-only emotion-image
side effect; document the skip).

Deferred to later sub-slices: `ableFlag` `<order, actions>` DSL
parsing (7-6c), script-cache (7-6c), module regex scripts (7-6d),
`runTrigger('display', …)` for `editdisplay` mode (7-6e).

Other Tier 1 candidates remain unblocked: **7-5c** (multimodal
inlays + `{{asset_prompt::}}`; the assets path benefits from a
clearer request-body inlay payload interface that Tier 3 will
shape - reasonable to wait) and **7-7a** (constant lorebook; the
SPA orchestrator still doesn't slice cleanly without porting the
decorator system first - revisit).

Same rhythm as prior slices: boot prompt-variable infra in tests
with `beforeAll(() => bootPromptVariables())`, small database
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
