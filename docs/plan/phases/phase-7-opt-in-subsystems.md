# Phase 7: Opt-In Subsystems (Root 5)

Status: pending; M15/M16, M18/L48, M19, M20/L54/L57, and L58/L59 slices done
on 2026-06-06.
Independent; order by pain. Largest finding count, but most fixes are small
and local (several are one-liners).

Goal: make the translate/TTS/MCP/file-import subsystems stop leaking,
hanging, truncating, and over-working once enabled. These paths were outside
every prior workstream's scope; they carry the audit's hardest breakage
(silent data loss, permanent feature death, unbounded growth).

Findings: M15, M16, M18, M19, M20, M21, M22, L48-L59, K3.

## Slices

- M15/M16 (done):
  [`slices/phase-7-opt-in-subsystems/translation-cache-and-streaming-guards.md`](slices/phase-7-opt-in-subsystems/translation-cache-and-streaming-guards.md)
  - bound the auto-translate cache and suppress streaming-frame Google/default
    translation work and HTML logs.
- L58/L59 (done):
  [`slices/phase-7-opt-in-subsystems/translation-ui-race-and-retry-bounds.md`](slices/phase-7-opt-in-subsystems/translation-ui-race-and-retry-bounds.md)
  - epoch-guard translated suggestions and stop `markParsing` from retrying
    network translation failures through the full parse pipeline.
- M19 (done):
  [`slices/phase-7-opt-in-subsystems/bergamot-chain-recovery.md`](slices/phase-7-opt-in-subsystems/bergamot-chain-recovery.md)
  - keep bergamot serialization without permanently poisoning the promise
    chain after a rejected translation; reset cached translator state after
    hard wasm/translator failures.
- M18/L48 (done):
  [`slices/phase-7-opt-in-subsystems/tts-context-and-hf-retry-bounds.md`](slices/phase-7-opt-in-subsystems/tts-context-and-hf-retry-bounds.md)
  - reuse TTS `AudioContext`s, release playback nodes, and cap HuggingFace
    retry/translation work.
- M20/L54/L57 (done):
  [`slices/phase-7-opt-in-subsystems/mcp-deadlines-listeners-and-debug-logs.md`](slices/phase-7-opt-in-subsystems/mcp-deadlines-listeners-and-debug-logs.md)
  - add MCP request/handshake/SSE deadlines, remove unresolved listeners, and
    gate MCP debug logs.
- L55/L56:
  [`slices/phase-7-opt-in-subsystems/mcp-internal-tool-index-and-filesystem-handle.md`](slices/phase-7-opt-in-subsystems/mcp-internal-tool-index-and-filesystem-handle.md)
  - cache internal MCP tool schemas, index tool dispatch, and preserve the
    FileSystem directory handle across client recreation.
- M21:
  [`slices/phase-7-opt-in-subsystems/charx-import-stream-cap.md`](slices/phase-7-opt-in-subsystems/charx-import-stream-cap.md)
  - fix the CharX size guard and enforce the asset byte cap while streaming.
- M22/L52/L53:
  [`slices/phase-7-opt-in-subsystems/file-send-po-pdf-and-logs.md`](slices/phase-7-opt-in-subsystems/file-send-po-pdf-and-logs.md)
  - remove the `.po` test cap, stop file-send console logs, and pass raw PDF
    bytes to pdfjs.
- L49/L50/K3:
  [`slices/phase-7-opt-in-subsystems/inlay-image-and-blob-cache-bounds.md`](slices/phase-7-opt-in-subsystems/inlay-image-and-blob-cache-bounds.md)
  - make inlay image writes fail instead of hang, bound/revoke blob URLs, and
    check the blob cache before fetching asset bytes.
- L51:
  [`slices/phase-7-opt-in-subsystems/png-card-import-single-pass.md`](slices/phase-7-opt-in-subsystems/png-card-import-single-pass.md)
  - avoid decoding PNG character-card asset chunks twice for progress.
- Proof:
  [`slices/phase-7-opt-in-subsystems/phase-7-verification-refresh.md`](slices/phase-7-opt-in-subsystems/phase-7-verification-refresh.md)
  - refresh gates, focused proofs, full validation, and latest verification.

## Source Anchors

- [`../audit-stability-and-performance-v2.md`](../audit-stability-and-performance-v2.md) -
  M15, M16, M18-M22, L48-L59; K3 under Known-Item Overlaps.
- Translate: `src/ts/translator/translator.ts` (M15 parallel-array cache,
  M16 google `DoingChat` gap + `console.log(html)`, L58/L59 callers in
  `Suggestion.svelte`/`ChatBody.svelte`),
  `src/ts/translator/bergamotTranslator.ts` (M19 poisoned chain).
- TTS: `src/ts/process/tts.ts` (M18 AudioContext per playback, L48 HF retry
  loop).
- MCP: `src/ts/process/mcp/mcplib.ts` (M20 no deadlines, L54 SSE listener
  leak, L57 logs), `mcp.ts` (L55 tool-list rebuild),
  `filesystemclient.ts` (L56 directory-handle loss).
- Files/import: `src/ts/process/processzip.ts` (M21 precedence bug),
  `src/ts/process/files/multisend.ts` (M22 .po cap, L52 logs, L53 pdf
  bytes), `src/ts/process/files/inlays.ts` (L49 onload hang),
  `src/ts/parser/parser.svelte.ts` (L50 blobUrlCache, K3 fetch-before-cache
  ordering), `src/ts/characterCards.ts` + `src/ts/pngChunk.ts` (L51 double
  decode).

## Planned Shape

- Stability one-liners first: M21 (parenthesize AND add the mid-stream byte
  cap + `file.terminate()` — the parens alone are insufficient for
  data-descriptor entries), M22 (delete the test cap), M19 (catch/reset the
  chain), M16 (remove the log).
- M15: Map keyed `${reverse}|${text}` with LRU bound; de-dup before push;
  reset on chat switch. M16's second half extends the `DoingChat`
  suppression to non-exp translators so streaming messages are not
  re-translated per frame.
- M18: one lazily-created module-level AudioContext (resume on gesture), or
  close-per-call in `onended`; cover the gptsovits gain path and `stopTTS`.
- M20: bounded deadline through `fetchNative` + timeout-raced SSE-resolution
  promises that remove their listeners (also closes L54); surface timeouts
  as RPC errors, not hangs.
- K3 is an ordering fix only: consult `blobUrlCache` before fetching asset
  bytes; the bulk-byte route stays on its leftover.md gate.
- Success-path outputs must not change: translation results, TTS audio,
  MCP tool dispatch, and import results stay identical; the fixes bound
  failure and repeat-work modes.

## Exit Criteria

- [ ] M21: an oversized charx asset entry is abandoned mid-stream under the
      cap (memory assertion); valid imports byte-identical.
- [ ] M22: a >100-line .po file translates fully (fixture test).
- [x] M19: a rejected bergamot translate recovers on the next call.
- [x] M18: repeated TTS playbacks hold at most one live AudioContext
      (counting assertion via a stubbed constructor).
- [x] L48: HuggingFace TTS translates once and caps 503 retry attempts.
- [x] M15: translate lookups are O(1) and the cache is bounded; M16:
      streaming with google auto-translate performs zero mid-stream
      translateHTML runs and zero html logs.
- [x] M20/L54: a hung MCP server fails the operation within the deadline,
      removes its listeners, and surfaces an error result.
- [ ] L49-L53, L55, L56, K3: each has a focused behavior/counting test per
      its target fix in the risk map.
- [ ] Gates registered; focused suites + TypeScript checks green;
      [`../latest-verification.md`](../latest-verification.md) updated.

## Validation

```bash
pnpm exec vitest run src/ts/process/coldstorage.test.ts src/ts/process/ttsHooks.test.ts
pnpm exec vitest run src/ts/characters.importChat.test.ts src/ts/storage/risuSave.test.ts
pnpm test && pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
```
