# Slice: Parser Render Fast Paths

Phase: [5](../../phase-5-client-render-and-ui.md). Findings: L38, L39.
Runtime change.

## Scope

Remove render-path `console.log` calls from `risuChatParser` and add the
marker-free/indexed fast path for `parseThoughtsAndTools`.

This slice does not change CBS semantics, markdown rendering, inlay parsing, or
the Phase 3 parser bounds work.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L38 and L39.
- `src/ts/parser/risuChatParser.ts`: the `{{#function}}` body log and
  `{{call::}}` function-object log.
- `src/ts/parser/parser.svelte.ts`: `parseThoughtsAndTools` and its call from
  `ParseMarkdown`.
- Existing parser test homes: `src/ts/parser/tests/` and
  `src/ts/process/scripts.editdisplay.test.ts`.
- New focused test home: `src/ts/parser/tests/renderFastPaths.test.ts`.

## Target Shape

- Delete the two `console.log` calls in the function-definition and function
  call branches of `risuChatParser`.
- Add a cheap marker check before `parseThoughtsAndTools` does any per-character
  work. If the message has neither `<Thoughts>` nor `<tool_call>`, return the
  original string unchanged.
- Replace the character-by-character `slice(i, i + 10)` scan with an
  `indexOf('<Thoughts>', from)` driven loop while preserving nested
  `<Thoughts>` handling and exact output.
- Keep `<tool_call>` replacement behavior identical, including language lookup
  and unknown-tool fallback text.
- Add tests that compare outputs for marker-free text, single/nested
  `<Thoughts>`, malformed/unclosed thoughts, tool calls, and mixed thoughts plus
  tool calls.
- Add a no-log regression test around a display-trigger/CBS parse path.
- Register L38 and L39 as `DONE` in the v2 gate with focused parser tests, and
  flip both rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Parser output must be byte-for-byte identical to the old behavior for covered
  valid and malformed inputs.
- Function registration and `{{call::}}` recursion/call-stack behavior must not
  change.
- The marker-free fast path must not skip `<tool_call>` replacement when a tool
  marker is present without `<Thoughts>`.
- No warm render path should write full message/parser payloads to
  `console.log`.

## Done Criteria

- Marker-free `ParseMarkdown` avoids the `parseThoughtsAndTools` per-character
  scan and returns identical sanitized output.
- `{{#function}}` and `{{call::}}` parsing emits no `console.log`.
- Focused parser tests cover nested and malformed thought/tool combinations.
- The L38 and L39 v2 gate entries point at real tests and the risk-map rows are
  `DONE`.

## Validation

```bash
pnpm exec vitest run src/ts/parser/tests/renderFastPaths.test.ts src/ts/parser/tests/cbs/strings.test.ts src/ts/parser/tests/cbs/conditionals.test.ts src/ts/process/scripts.editdisplay.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
