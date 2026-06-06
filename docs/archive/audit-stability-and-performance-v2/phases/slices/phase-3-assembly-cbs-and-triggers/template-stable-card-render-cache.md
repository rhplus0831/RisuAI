# Slice: Template Stable Card Render Cache

Phase: [3](../../phase-3-assembly-cbs-and-triggers.md). Finding: M3. Planned
before [`cbs-history-lore-callback-memo.md`](cbs-history-lore-callback-memo.md).
Runtime change.

## Scope

Render the prompt-template card subset whose output is stable across token
preflight and final render once per assembly, then reuse those rows for both
passes. The owned subset is plain, jailbreak, cot, chatML, and the
persona/description/authornote inner-format wrappers.

This slice deliberately leaves `chat`, `postEverything`, `memory`, and `cache`
cards live. Their inputs or side effects can change between preflight and final
render.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M3.
- `server/fastify/src/prompt/templates.ts`: `renderContentCard`,
  `renderByTemplate`, `parseChatML`, `pushPromptInfoBody`.
- `server/fastify/src/prompt/preflight.ts`: `preflightTemplateTokens`.
- `server/fastify/src/prompt/assemble.ts`: `fillLorebookSlots`,
  `renderFinalPrompt`.
- Existing focused tests:
  `server/fastify/__tests__/templates.test.ts`,
  `server/fastify/__tests__/assemble.test.ts`,
  `server/fastify/__tests__/generation.chat.test.ts`.

## Target Shape

- Add a per-assembly stable-card cache that can be shared by
  `preflightTemplateTokens` and `renderByTemplate`. Key it by card identity or
  template index plus the minimal stable inputs needed for parity.
- Route only stable cards through the cache:
  `plain`, `jailbreak`, `cot`, `chatML`, and inner-format wrapping for
  `persona`, `description`, and `authornote`.
- Do not cache `chat` cards because `unformated.chats` is populated after
  preflight. Do not cache `postEverything` because start triggers and prompt-end
  additions can mutate it after preflight. Keep `memory` and `cache` inline
  because they depend on the accumulated final render rows.
- Keep prompt-info capture correct. Preflight should not populate prompt-info
  rows; final render should still emit the same prompt-info bytes even when it
  reuses cached card rows.
- Clone cached rows on read before coalescing or mutating them so the final
  renderer cannot mutate cache entries or rows later reused by tests.
- Surface side-effect-bearing CBS consistently. A stable card body containing
  `{{setvar}}` should evaluate exactly once per assembly, and that one
  evaluation's dirty state must be folded into the assembly chat-var mutation
  flow.
- Add counting tests for one render per stable card per send, plus regression
  tests for `{{setvar}}` in stable cards and for the full template matrix:
  template/non-template, `promptInfoInsideChat` on/off, automatic cache point,
  explicit cache card, jailbreak/cot toggles.
- Register M3 as `DONE` in the v2 gate with focused behavior and cost tests,
  and flip the M3 row in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Prompt bytes remain identical for every non-pathological template fixture.
- Chat cards still see the post-history, post-memory chat rows.
- Post-everything cards still see start-trigger prompt-end additions.
- Prompt-info rows remain identical and are emitted only in the final render
  path.
- A cached row must not carry `cachePoint` or other mutations from a previous
  render read unless that mutation is part of the cached card's own stable
  output.

## Done Criteria

- Stable card CBS expansion count is one per card per assembly.
- A stable card with `{{setvar}}` evaluates exactly once and persists the
  expected chat-var delta.
- Chat and postEverything cards continue to render live and keep output parity.
- The v2 gate and active-risk row mark M3 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/templates.test.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/generation.chat.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
