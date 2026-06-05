# Slice: History Fixed-Point And Depth Preflight

Phase: [3](../../phase-3-assembly-cbs-and-triggers.md). Findings: M2, L8,
L9. Runtime change.

## Scope

Remove redundant CBS expansion from the history window: marker-free message
rows should skip `risuChatParser`, `SEND_NAME_WRAPPER` should expand once per
assembly, and lorebook depth-prompt bodies should expand once for both token
preflight and final splice.

This slice does not own template content-card preflight, CBS history/lore
callbacks, or message-capture clone avoidance except where tests need to keep
the Phase 3 cost surface coherent.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M2, L8, and L9.
- `server/fastify/src/prompt/history.ts`: `SEND_NAME_WRAPPER`,
  `formatHistoryMessage`, `buildHistoryWindow`, `getDepthPrompts`,
  `applyDepthPrompts`.
- `server/fastify/src/prompt/assemble.ts`: `isRunVarParserFixedPoint`
  precedent and `fillHistoryAndBias` -> `fillMemoryAndPostHistory` handoff.
- Existing focused tests:
  `server/fastify/__tests__/assemble.test.ts`,
  `server/fastify/__tests__/generation.chat.test.ts`,
  `server/fastify/__tests__/lorebook.test.ts`,
  `server/fastify/__tests__/templates.test.ts`.

## Target Shape

- Move the run-var fixed-point predicate to a small shared prompt helper, or
  otherwise make it reusable without introducing an import cycle. The predicate
  must treat marker-free prose with no `<user|char|bot>` tags as a parser fixed
  point.
- Apply that guard in `formatHistoryMessage` before `expandVariables(msg.data)`.
  Preserve the existing `undefined -> ''` coercion and continue to expand rows
  that contain parser markers or legacy speaker tags.
- Pre-expand `SEND_NAME_WRAPPER` once per `buildHistoryWindow` call when
  `usingPromptTemplate && sendName` is true, then pass the prepared wrapper into
  `formatHistoryMessage`. Keep the effective behavior where the active
  `currentChar` supplies `{{char}}`.
- Prepare lorebook depth-prompt rows once when `buildHistoryWindow` performs
  the token preflight. The prepared row content should be stored on the
  assembly state or returned beside `HistoryWindowResult` so
  `applyDepthPrompts` can splice the same expanded bytes later.
- Keep depth/reverse-depth insertion indexes live. Only the prompt body
  expansion and token count are cached; final splice positions still use the
  post-memory `messages.length` semantics.
- Add counting tests that fail if marker-free history rows invoke
  `expandVariables`, if `SEND_NAME_WRAPPER` expands per message, or if a depth
  prompt body expands once in preflight and again during splice.
- Register M2, L8, and L9 as `DONE` in the v2 gate with focused tests, and
  flip their rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Marker-bearing rows, asset prompts, inlays, thoughts extraction, Lua
  `editprocess`, and regex `editprocess` continue to run in the same order.
- Prompt bytes remain identical for template and non-template paths, including
  `promptInfoInsideChat` on/off and depth/reverse-depth lorebook fixtures.
- Depth prompt token accounting stays identical to the bytes eventually
  spliced into the prompt.
- The fixed-point helper remains conservative: if a future parser marker could
  rewrite the row, the guard must not skip it.

## Done Criteria

- Marker-free history rows skip the CBS parse with a counting assertion.
- Marker rows and legacy speaker-tag rows still expand and keep output parity.
- `SEND_NAME_WRAPPER` expansion count is one per applicable assembly, not one
  per history message.
- Depth-prompt bodies expand once and are reused for token preflight and final
  splice.
- The v2 gate and active-risk rows mark M2, L8, and L9 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/templates.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
