# Next Steps

Date: 2026-06-06

Phases 1-3 and Phase 6 are implemented and proof-refreshed. The next fix
batch after Phase 6 is Phase 7.

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
  tool dispatch, and import/export bytes stay semantically identical unless a
  slice explicitly calls out a bug fix.
- Bounds must be observable in tests: cache sizes, listener counts, retry
  counts, deadlines, byte caps, and log suppression should have focused
  assertions.
- K3 is only a cache-ordering fix. The bulk-byte asset route remains under the
  existing leftover evidence gate.
- MCP timeout fixes should surface bounded error results and release listeners;
  they should not convert hangs into silent success.
- Do not schedule L12 or the v1 carry-over gates (v1-L4, v1-L7, v1-L26,
  v1-U2) without evidence or owner approval.

## Proof Commands

Use the smallest focused command first. Broaden when a change touches shared
client state, rollback, projection guards, or server-backed command behavior.

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

Optional metric review: clone-cost harness assertions in the focused tests,
`RISU_PROTOCOL_METRICS=1` only when a change crosses the server send path,
and `pnpm analyze:db <input>` for static corpus comparisons.
