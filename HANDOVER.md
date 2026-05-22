# HANDOVER

Date: 2026-05-23
Branch: `fastify`
Head: `c44e53fc feat: port minimal history walk (Phase 7-5a)`

This is the short runbook for picking up **Phase 7 in progress**.
Phases 0-6 are closed. The detailed Phase 7 roadmap lives in
[`docs/fastify/phases/phase-7-prompt-assembly.md`](docs/fastify/phases/phase-7-prompt-assembly.md);
this file only records the current handoff state and the next slice.

## Current State

Landed Phase 7 slices:

| Slice | Commit     | Summary                                                                                                                     |
| ----- | ---------- | --------------------------------------------------------------------------------------------------------------------------- |
| 7-1   | `3d2426c4` | Scaffolded auth-gated `POST /api/v1/generate/chat`, locked the nine prompt SSE event names, and added prompt module shells. |
| 7-2a  | `9eed5093` | Added Svelte-free DI seams for chat variables and `trigger_id`.                                                             |
| 7-2b  | `bb2c78b5` | Lifted `risuChatParser` and helpers into Svelte-free modules while preserving SPA re-exports.                               |
| 7-2c  | `7ed156e6` | Wired the server parser adapter: `promptScope.ts`, `cbsAdapter.ts`, `promptVariablesBoot.ts`, and real `expandVariables`.   |
| 7-3   | `d0a2a7f3` | Ported static prompt sections: description, author note, persona, and chain-of-thought.                                     |
| 7-4   | `051a5dcd` | Ported plain prompt sections: main, jailbreak, and global note.                                                             |
| docs  | `e7a76f32` | Organized the remaining Phase 7 roadmap into tiers.                                                                         |
| 7-5a  | `c44e53fc` | Ported the minimal history walk: examples, start-new-chat marker, first message, makeMs filter, per-message role mapping.   |

What is real in code:

- `server/fastify/src/routes/generationChat.ts` validates request
  bodies and emits `stage(validate)` -> `error` -> `done`; it does
  **not** call `assemble.ts` yet.
- `server/fastify/src/prompt/sseEvents.ts`,
  `variables.ts`, `staticSections.ts`, `plainSections.ts`, and
  `history.ts` (minimal walk only) are implemented and tested.
- `assemble.ts`, `lorebook.ts`, `templates.ts`, `tokens.ts`, and
  `triggers.ts` still throw Phase 7 not-implemented errors.
- `history.ts` does not yet handle scripts, sendName, `<Thoughts>`,
  multimodal, `{{asset_prompt::}}`, start triggers, tokenizer
  accumulation, or depth prompts (7-5b/c/d/e).
- There is no `/api/v1/generate/preview-prompt` route yet.

Last recorded baselines after 7-5a:

- `pnpm api:test`: 502 across 32 files
- `pnpm test`: 601 across 46 files (+ 4 skipped)
- `pnpm check`: 0 errors / 0 warnings
- `pnpm build`: clean

## Next Slice

Pick from the Tier 1 slices that have no outstanding Tier 2
dependency:

- **7-5c** - multimodal inlays + `{{asset_prompt::}}` replacement.
  Depends only on the Phase 2 assets API (already closed).
- **7-6** - scripts port. Standalone. Almost certainly needs
  further sub-slicing at the start of the slice; the SPA module
  is ~700 LOC across regex scripting, custom-script execution,
  and edit vs post-time phases. Unlocks 7-5b.
- **7-7a** - constant lorebook entries (always-on). Standalone.
  First leaf in the lorebook tier.

**7-5b is blocked by 7-6**. **7-5d is blocked by 7-9c**. **7-5e is
blocked by 7-7e and 7-8.** Pick one of 7-5c / 7-6 / 7-7a; report a
plan with concrete LOC + test scope before starting.

Same pattern as 7-3 / 7-4 / 7-5a: boot prompt-variable infra in
tests with `beforeAll(() => bootPromptVariables())`, use small
database fixtures, normalize structured outputs to `OpenAIChat[]`
when applicable, and run all four bars (`pnpm check`,
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
