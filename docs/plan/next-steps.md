# Next Steps

Date: 2026-06-06

Phases 1-6 are implemented and proof-refreshed. The remaining open fix
batches are Phases 7 and 8.

## Completed Batch: Phase 4 (Client Clone Narrowing Ring 2)

Client clone narrowing ring 2 is complete and proof-refreshed:
M7-M10, L32-L34, L37, and K4 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 4 proof
refresh passed focused clone/rollback suites, v2 and clone-cost gates,
`pnpm test` (1202 passed / 4 skipped), `pnpm api:test` (1792 passed / 1
skipped), `pnpm client-thinning:audit`, and both TypeScript checks. See
[`latest-verification.md`](latest-verification.md).

## Completed Batch: Phase 5 (Client Render & UI)

Client render and UI work is complete and proof-refreshed:
M13, M17, and L38-L44 are `DONE` in the v2 gate and
[`active-risk-analysis.md`](active-risk-analysis.md). The Phase 5 proof
refresh passed focused render/UI suites, render-count/script proof, parser
companion suites, both gates, `pnpm test` (1193 passed / 4 skipped),
`pnpm client-thinning:audit`, and both TypeScript checks. The repository-wide
`pnpm check` still reports the pre-existing 14-error baseline. See
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

## Next Batch: Phase 7 (Opt-In Subsystems)

Opt-in subsystem stability is defined in
[`phases/phase-7-opt-in-subsystems.md`](phases/phase-7-opt-in-subsystems.md):

1. M15/M16 translation cache and streaming guards
   ([slice](phases/slices/phase-7-opt-in-subsystems/translation-cache-and-streaming-guards.md)):
   bound the auto-translate cache, suppress streaming-frame non-exp
   translation work, and remove HTML logs.
2. L58/L59 translation UI race and retry bounds
   ([slice](phases/slices/phase-7-opt-in-subsystems/translation-ui-race-and-retry-bounds.md)):
   epoch-guard translated suggestions and stop network translation failures
   from retrying through the full parse pipeline.
3. M19 bergamot chain recovery
   ([slice](phases/slices/phase-7-opt-in-subsystems/bergamot-chain-recovery.md)):
   reset the serialized bergamot promise chain after rejection so later
   translations can recover.
4. M18/L48 TTS context and HuggingFace retry bounds
   ([slice](phases/slices/phase-7-opt-in-subsystems/tts-context-and-hf-retry-bounds.md)):
   reuse or close playback `AudioContext`s and cap HuggingFace retry/
   translation work.
5. M20/L54/L57 MCP deadlines, listeners, and debug logs
   ([slice](phases/slices/phase-7-opt-in-subsystems/mcp-deadlines-listeners-and-debug-logs.md)):
   add bounded MCP request/handshake/SSE waits, remove unresolved listeners,
   and gate MCP debug output.
6. L55/L56 MCP internal tool index and filesystem handle
   ([slice](phases/slices/phase-7-opt-in-subsystems/mcp-internal-tool-index-and-filesystem-handle.md)):
   cache internal MCP tool schemas, index tool dispatch, and preserve the
   FileSystem directory handle across client recreation.
7. M21 CharX import stream cap
   ([slice](phases/slices/phase-7-opt-in-subsystems/charx-import-stream-cap.md)):
   parenthesize the guard and enforce the asset byte cap while streaming.
8. M22/L52/L53 file send, `.po`, PDF, and logs
   ([slice](phases/slices/phase-7-opt-in-subsystems/file-send-po-pdf-and-logs.md)):
   remove the `.po` test cap, remove file-send console logs, and pass raw PDF
   bytes to pdfjs.
9. L49/L50/K3 inlay image and blob cache bounds
   ([slice](phases/slices/phase-7-opt-in-subsystems/inlay-image-and-blob-cache-bounds.md)):
   fail inlay image writes instead of hanging, bound/revoke blob URLs, and
   check the blob cache before fetching asset bytes.
10. L51 PNG card import single pass
    ([slice](phases/slices/phase-7-opt-in-subsystems/png-card-import-single-pass.md)):
    avoid decoding PNG character-card asset chunks twice for progress.
11. Phase 7 verification refresh
    ([slice](phases/slices/phase-7-opt-in-subsystems/phase-7-verification-refresh.md)):
    refresh gates, focused proofs, full validation, and latest verification.

## Guardrails

- Preserve success-path outputs: translation text, TTS playback behavior, MCP
  tool dispatch, import/export bytes, generation responses, DB durability,
  memory jobs, and realm import behavior stay semantically identical unless a
  slice explicitly calls out a bug fix.
- Bounds must be observable in tests: cache sizes, listener counts, retry
  counts, deadlines, byte caps, queue depth, and log suppression should have
  focused assertions.
- K3 is only a cache-ordering fix. The bulk-byte asset route remains under the
  existing leftover evidence gate.
- MCP timeout fixes should surface bounded error results and release listeners;
  they should not convert hangs into silent success.
- Do not schedule L12 or the v1 carry-over gates (v1-L4, v1-L7, v1-L26,
  v1-U2) without evidence or owner approval.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches shared
client state, import/export bytes, MCP transport behavior, or client/server
contracts.

Phase 7 focused runs:

```bash
pnpm exec vitest run src/ts/process/coldstorage.test.ts src/ts/process/ttsHooks.test.ts
pnpm exec vitest run src/ts/characters.importChat.test.ts src/ts/storage/risuSave.test.ts
pnpm exec vitest run src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/mcplib.test.ts
pnpm exec vitest run src/ts/process/files/tests/inlays.test.ts src/ts/globalApi.getFileSrc.test.ts
```

Full proof set:

```bash
pnpm test
pnpm api:test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Optional metric review: listener/cache/deadline/byte-cap assertions in focused
tests, `RISU_PROTOCOL_METRICS=1` only when a change crosses the server send
path, and `pnpm analyze:db <input>` for static corpus comparisons.

## Current Validation Caveats

The Phase 5 proof refresh is green for focused suites, both gates, and
`pnpm test` after the proof-refresh isolation fix. The remaining nonzero
baseline in [`latest-verification.md`](latest-verification.md) is `pnpm check`
retaining its 14-error svelte-check baseline.
