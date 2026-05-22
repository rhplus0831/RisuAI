# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `9a60380d feat: port minimal regex script processor (Phase 7-6a)`

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

What is real in code:

- `server/fastify/src/routes/generationChat.ts` validates request
  bodies and emits `stage(validate)` -> `error` -> `done`; it does
  **not** call `assemble.ts` yet.
- `server/fastify/src/prompt/sseEvents.ts`,
  `variables.ts`, `staticSections.ts`, `plainSections.ts`,
  `history.ts` (minimal walk only), and `scripts.ts` (regex-only
  `processScript`) are implemented and tested.
- `assemble.ts`, `lorebook.ts`, `templates.ts`, `tokens.ts`, and
  `triggers.ts` still throw Phase 7 not-implemented errors.
- `history.ts` does not yet call `processScript` per message, and
  does not yet handle `sendName`, `<Thoughts>`, multimodal,
  `{{asset_prompt::}}`, start triggers, tokenizer accumulation, or
  depth prompts (7-5b/c/d/e).
- `scripts.ts` does not yet handle special action prefixes
  (`@@emo`, `@@move_top`, `@@move_bottom`, `@@inject`,
  `@@repeat_back`), the `ableFlag` `<order, actions>` DSL,
  script-cache, `runLuaEditTrigger`, `runTrigger('display', …)`,
  `pluginV2` hooks, or module regex scripts (7-6b/c/d/e).
- There is no `/api/v1/generate/preview-prompt` route yet.

Last recorded baselines after 7-6a:

- `pnpm api:test`: 516 across 33 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean

## Next Slice

Pick up **7-5b - history per-message scripts + sendName +
`<Thoughts>` extraction**.

`server/fastify/src/prompt/scripts.ts` is now real (regex-only),
so the per-message `processScriptFull('editprocess', ...)` call in
`formatHistoryMessage` can be ported via the existing
`processScript`. Slice scope:

- Pipe each history message's `msg.data` through
  `processScript(ctx, currentChar, data, 'editprocess', {chatRole: msg.role})`
  before role mapping.
- Add the optional `usingPromptTemplate + db.promptSettings.sendName`
  wrapper that prefixes the first message and per-message content
  with `${currentChar.name}: ` (and sets `attr: ['nameAdded']` on
  the first message only). The per-message form ports the
  `<{{char}}'s Message>\n{{slot}}\n</{{char}}'s Message>` wrapper
  from `formatHistoryMessage.ts:138`.
- Add `<Thoughts>...</Thoughts>` extraction with the
  `maxThoughtTagDepth` clamp: stripped from `content`, captured to
  `chat.thoughts: string[]` when `maxThoughtDepth === -1 ||
maxThoughtDepth - totalCount <= index`.

Other Tier 1 candidates remain unblocked: **7-5c**
(multimodal/asset_prompt; needs the Phase 2 server-side asset
read path; see formatHistoryMessage.ts for the SPA shape) and
**7-7a** (constant lorebook; the SPA orchestrator does not slice
cleanly without porting the decorator system first - revisit).

Same rhythm as the prior slices: boot prompt-variable infra in
tests with `beforeAll(() => bootPromptVariables())`, small
database fixtures, and run all four bars (`pnpm check`,
`pnpm api:test`, `pnpm test`, `pnpm build`) before reporting back.

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
