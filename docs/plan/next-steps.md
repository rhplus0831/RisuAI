# Next Steps

Date: 2026-06-06

Phases 1-4 and Phase 6 are implemented and proof-refreshed. The remaining
open fix batches are Phases 5, 7, and 8.

## Completed Batch: Phase 4 (Client Clone Narrowing Ring 2)

Client clone narrowing ring 2 is complete and proof-refreshed:
M7-M10, L32-L34, L37, and K4 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 4 proof
refresh passed focused clone/rollback suites, v2 and clone-cost gates,
`pnpm test` (1202 passed / 4 skipped), `pnpm api:test` (1792 passed / 1
skipped), `pnpm client-thinning:audit`, and both TypeScript checks. See
[`latest-verification.md`](latest-verification.md).

## Completed Batch: Phase 6 (Bridges, Lifecycle & Network)

Bridge, lifecycle, and network work is complete and proof-refreshed:
M11, M12, M14, L35, L36, and L45-L47 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 6 proof
refresh passed focused bridge/lifecycle/network suites, v2 and clone-cost
gates, `pnpm test` (1185 passed / 4 skipped), `pnpm api:test` (1792 passed /
1 skipped), `pnpm client-thinning:audit`, and both TypeScript checks. The
repository-wide `pnpm check` still reports the pre-existing 14-error baseline.
See [`latest-verification.md`](latest-verification.md).

## Next Batch: Phase 5 (Client Render & UI)

Client render and UI costs are defined in
[`phases/phase-5-client-render-and-ui.md`](phases/phase-5-client-render-and-ui.md):

1. M13 prompt-template tokenize debounce
   ([slice](phases/slices/phase-5-client-render-and-ui/prompt-template-tokenize-debounce.md)):
   debounce prompt-template token counts and memoize per-item tokenization.
2. M17/L40 chatbody content-keyed parse memo
   ([slice](phases/slices/phase-5-client-render-and-ui/chatbody-content-keyed-parse-memo.md)):
   add a bounded module-level parse/translate-detection memo for `ChatBody`.
3. L38/L39 parser render fast paths
   ([slice](phases/slices/phase-5-client-render-and-ui/parser-render-fast-paths.md)):
   remove parser logs and fast-path thought/tool parsing.
4. L41 partial-edit shared hover handler
   ([slice](phases/slices/phase-5-client-render-and-ui/partial-edit-shared-hover-handler.md)):
   share partial-edit hover tracking across visible messages.
5. L42 grid catalog derived lists
   ([slice](phases/slices/phase-5-client-render-and-ui/grid-catalog-derived-lists.md)):
   derive and key `GridCatalog` character lists.
6. L43 module settings derived search
   ([slice](phases/slices/phase-5-client-render-and-ui/module-settings-derived-search.md)):
   derive and key `ModuleSettings` search results.
7. L44 sidebar character list signature
   ([slice](phases/slices/phase-5-client-render-and-ui/sidebar-character-list-signature.md)):
   replace sidebar list deep-compare with a cheap signature or derived memo.
8. Phase 5 verification refresh
   ([slice](phases/slices/phase-5-client-render-and-ui/phase-5-verification-refresh.md)):
   refresh gates, focused proofs, full validation, and latest verification.

## Guardrails

- Keep H3's variable-only GUI refresh contract intact while adding render
  memos; unchanged mounted chat messages should not reparse on var-only
  refreshes.
- Preserve rendered output bytes while removing parser/render work.
- Keep render/translate-detection memos bounded and invalidate them on relevant
  message content, character identity, or translate-flag changes.
- Preserve success-path outputs for the parallel Phase 7/8 work: translation
  text, TTS playback behavior, MCP tool dispatch, import/export bytes,
  generation responses, DB durability, memory jobs, and realm import behavior
  stay semantically identical unless a slice explicitly calls out a bug fix.
- Bounds must be observable in tests: cache sizes, listener counts, retry
  counts, deadlines, byte caps, queue depth, and log suppression should have
  focused assertions.
- Do not schedule L12 or the v1 carry-over gates (v1-L4, v1-L7, v1-L26,
  v1-U2) without evidence or owner approval.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches parser
output, shared Svelte component state, render-count baselines, or
client/server contracts.

Phase 5 focused runs:

```bash
pnpm exec vitest run src/ts/process/scripts.editdisplay.test.ts src/ts/process/scripts.regexCache.test.ts
pnpm exec vitest run src/ts/__tests__/renderCountBaseline.test.ts src/ts/__tests__/renderCostHarness.test.ts
pnpm check   # svelte-check; respect the pre-existing baseline count
```

Full proof set:

```bash
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Optional metric review: render-count and parse-count assertions from the Phase
0/H3 harnesses, and `pnpm analyze:db <input>` only if a change crosses stored
corpus shape.
