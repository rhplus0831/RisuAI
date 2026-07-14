# Slice: Lorebook Sticky Vars And Search Normalization

Phase: [3](../../phase-3-assembly-cbs-and-triggers.md). Findings: L4, L5.
Runtime change.

## Scope

Fix lorebook sticky-activation writes so they persist, and hoist repeated
message normalization out of `searchMatch` during recursive activation.

This slice is limited to lorebook activation and its assembly handoff. It does
not own template render caching, CBS callback memoization, trigger costs, or
parser micro-costs.

## Anchors

- [`../../../audit-stability-and-performance-v2.md`](../../../audit-stability-and-performance-v2.md)
  L4 and L5.
- `server/fastify/src/prompt/lorebook.ts`: `writeChatVar`, `searchMatch`,
  `activateLorebook`, recursive `while (matching)` loop,
  `buildLorebookContext`.
- `server/fastify/src/prompt/assemble.ts`: `fillLorebookSlots`,
  `buildChatVarMutations`, `syncWorkingScriptstate`.
- Existing focused tests:
  `server/fastify/__tests__/lorebook.test.ts`,
  `server/fastify/__tests__/generation.chat.test.ts`,
  `server/fastify/__tests__/assemble.test.ts`.

## Target Shape

- Route `@@keep_activate_after_match` and
  `@@dont_activate_after_match` internal chat-var writes through a persisted
  chat-var writer, not only the cloned working chat passed to lorebook
  activation.
- Fold lorebook sticky writes into the same chat-var delta mechanism used by
  trigger and Lua var writes. `buildChatVarMutations` should see
  `$__internal_ka_<loreId>` and `$__internal_da_<loreId>` transitions.
- Keep the working chat's `scriptstate` synchronized after sticky writes so the
  current assembly observes the same activation state it just persisted.
- Preserve preview/read-only semantics. If preview prompt assembly must not
  persist chat vars, the sticky write path should either be disabled there or
  recorded only in the returned preview state, matching the route's existing
  write policy.
- Precompute the base searchable message corpus once per lorebook activation:
  source labels, prompt strings, raw data, lowercased data, and any stripped
  forms needed by full-word/partial-word matching.
- Reuse normalized message entries across recursive activation passes. Append
  normalized recursive prompt entries as they are discovered rather than
  rebuilding all message normalization per `searchMatch` call.
- Keep regex key compilation on the existing `getCompiledLoreKeyRegex` cache,
  resetting `lastIndex` before every use.
- Add L4 regression coverage proving sticky activation survives across two
  sends on the fixture. Add L5 counting coverage proving repeated recursive
  search calls do not re-lowercase or re-strip the same base messages.
- Register L4 and L5 as `DONE` in the v2 gate with focused tests, and flip
  their rows in
  [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md) in the
  same commit.

## Invariants

- Lorebook activation order, priority sorting, token truncation, recursive
  prompt behavior, match log entries, and prompt bytes remain identical except
  for the intended persistence of sticky internal vars.
- `@@keep` and `@@dont_activate_after_match` keys use the same `loreId(entry)`
  values as before.
- Malformed regex lore keys still fail closed the same way.
- Preview/read-only routes must not accidentally commit sticky writes.

## Done Criteria

- `@@keep_activate_after_match` persists and affects the next send.
- `@@dont_activate_after_match` persists and prevents the next activation as
  specified.
- Recursive lorebook activation reuses normalized base-message search data.
- The v2 gate and active-risk rows mark L4 and L5 `DONE`.

## Validation

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts \
  server/fastify/__tests__/lorebook.test.ts \
  server/fastify/__tests__/generation.chat.test.ts \
  server/fastify/__tests__/assemble.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
