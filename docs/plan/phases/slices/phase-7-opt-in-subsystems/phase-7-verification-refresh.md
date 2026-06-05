# Slice: Phase 7 Verification Refresh

Phase: [7](../../phase-7-opt-in-subsystems.md). Depends on all Phase 7 runtime
slices. No runtime change.

## Scope

Run the focused and full proof set after M15, M16, M18-M22, L48-L59, and K3
land, then record the Phase 7 proof state. This is a verification and
documentation slice; it should not change runtime behavior.

## Anchors

- [`../../phase-7-opt-in-subsystems.md`](../../phase-7-opt-in-subsystems.md)
  exit criteria.
- [`../../../active-risk-analysis.md`](../../../active-risk-analysis.md):
  M15, M16, M18-M22, L48-L59, and K3 rows.
- [`../../../latest-verification.md`](../../../latest-verification.md).
- `src/ts/__tests__/fixCompletenessGateV2.test.ts`.
- TypeScript workflow from `AGENTS.md`.

## Target Shape

- Confirm every Phase 7 runtime finding is `DONE` in both the v2 gate registry
  and `active-risk-analysis.md`, with each `DONE` entry naming real regression
  tests.
- Re-run every focused suite named by the parent phase and by the Phase 7
  runtime slices.
- Re-run the v2 gate.
- Re-run the full proof set:
  `pnpm test`,
  `pnpm client-thinning:audit`,
  `pnpm exec tsc -p tsconfig.client-lib.json`, and
  `pnpm exec tsc -p server/fastify/tsconfig.json --noEmit`.
- Add a dated Phase 7 run-log entry to
  [`../../../latest-verification.md`](../../../latest-verification.md) with
  command outcomes and the relevant bounded-cache, listener-count,
  AudioContext-count, import-byte, and no-log summaries.
- Check off the parent Phase 7 exit criteria only for commands and assertions
  that actually passed.

## Invariants

- Do not mark an ID `DONE` without a real focused test path and test name.
- Do not silently replace a failed full proof with a narrower command. Focused
  diagnostics may be recorded, but the full command failure remains visible.
- Run the client-lib TypeScript build before the strict Fastify server check.
- This slice should not modify production code.

## Done Criteria

- `latest-verification.md` contains a fresh Phase 7 proof entry.
- M15, M16, M18-M22, L48-L59, and K3 are registered as `DONE` with test
  evidence in the v2 gate and risk map.
- The parent Phase 7 exit criteria match the recorded proof results.

## Validation

```bash
pnpm exec vitest run src/ts/translator/translator.cache.test.ts src/ts/translator/translator.html.test.ts src/ts/translator/bergamotTranslator.test.ts
pnpm exec vitest run src/lib/ChatScreens/Suggestion.svelte.test.ts src/lib/ChatScreens/ChatBody.svelte.test.ts
pnpm exec vitest run src/ts/process/tts.test.ts src/ts/process/ttsHooks.test.ts
pnpm exec vitest run src/ts/process/mcp/mcplib.test.ts src/ts/process/mcp/mcp.test.ts src/ts/process/mcp/internalClients.test.ts src/ts/process/mcp/googlesearchclient.test.ts
pnpm exec vitest run src/ts/process/processzip.test.ts src/ts/process/files/multisend.test.ts src/ts/process/files/tests/inlays.test.ts
pnpm exec vitest run src/ts/parser/tests/inlayBlobCache.test.ts src/ts/characterCards.pngImport.test.ts src/ts/characters.importChat.test.ts src/ts/storage/risuSave.test.ts
pnpm exec vitest run src/ts/__tests__/fixCompletenessGateV2.test.ts
pnpm test
pnpm client-thinning:audit
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
