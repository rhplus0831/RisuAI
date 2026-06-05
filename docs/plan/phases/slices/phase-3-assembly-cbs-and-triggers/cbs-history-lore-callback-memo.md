# Slice: CBS History And Lore Callback Memo

Phase: [3](../../phase-3-assembly-cbs-and-triggers.md). Finding: M4. Depends
on [`template-stable-card-render-cache.md`](template-stable-card-render-cache.md)
so template preflight no longer doubles the callback cost. Runtime change.

## Scope

Memoize the expensive `{{charhistory}}`, `{{userhistory}}`, and `{{lorebook}}`
CBS callback outputs within one prompt assembly. Repeated references in stable
cards, lore rows, or other server-expanded prompt text should reuse the same
computed JSON array when the selected chat/lore inputs have not changed.

This slice does not change which lore sources are visible server-side. Module
lore remains absent on the server because `cbsAdapter.ts` currently wires
`getModuleLorebooks: () => []`.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  M4.
- `src/ts/cbs.ts`: `lorebook`, `userhistory`, `charhistory` callbacks.
- `src/ts/parser/risuChatParser.ts`: `RisuChatParserArg`, matcher argument
  plumbing.
- `server/fastify/src/prompt/cbsAdapter.ts`: server parser adapter and module
  lore wiring.
- `server/fastify/src/prompt/variables.ts`: `expandVariables` and
  `ExpandContext`.
- Existing focused tests:
  `server/fastify/__tests__/assemble.test.ts`,
  `server/fastify/__tests__/generation.chat.test.ts`,
  `server/fastify/__tests__/lorebook.test.ts`.

## Target Shape

- Add an assembly-scoped callback memo surface to the parser/matcher argument
  or `ExpandContext`. The memo must be opt-in so browser-local parser calls
  without an assembly context keep existing behavior.
- Key `charhistory` and `userhistory` by selected character, chat id/page,
  message revision/signature, role, and any parser argument that can affect the
  nested `risuChatParser(v.data, matcherArg)` output.
- Key `lorebook` by selected character, target `matcherArg.chara` identity,
  chat id/page, character global-lore identity, and local-lore identity. Do not
  include module lore in the server key unless the server adapter starts
  returning module lore.
- Invalidate or bypass the memo after an in-assembly message mutation that can
  change the history callbacks' output. A simple assembly-local generation
  counter is acceptable if it increments on every message mutation adopted by
  the assembler.
- Store the final callback string, not mutable intermediate arrays, so repeated
  callback calls cannot mutate shared memo state.
- Add counting tests that repeat each callback multiple times in one assembly
  and prove the transcript/lore scan happens once while output stays identical.
- Register M4 as `DONE` in the v2 gate with focused tests, and flip the M4 row
  in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Callback output bytes remain identical for user-only, char-only, mixed-role,
  alternate speaker, character-lore, and chat-local-lore fixtures.
- A message or lore mutation inside the same assembly must not return stale
  callback output.
- The browser parser API remains source-compatible for callers that do not pass
  a memo.
- Module lore stays dead server-side unless a separate slice changes
  `cbsAdapter.ts`.

## Done Criteria

- Repeated `{{charhistory}}`, `{{userhistory}}`, and `{{lorebook}}` references
  within one assembly evaluate once per stable input signature.
- Mutation invalidation tests prove no stale history/lore callback output after
  an adopted in-assembly change.
- Prompt bytes are identical to the pre-memo behavior.
- The v2 gate and active-risk row mark M4 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/assemble.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/lorebook.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
