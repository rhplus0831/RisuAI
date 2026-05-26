# Phase 5 Alpha - sendChat Boundary Cleanup

Date: 2026-05-27

Status: closed.

## Summary

Closed the Phase 5 alpha boundary drift by restoring
`src/ts/process/index.svelte.ts` to a thin coordinator shape. The
coordinator is now 358 lines, down from the 703-line audit finding and
below the under-500-line exit target.

## Landed Scope

- Extracted server-backed `/chat` assembly, generation dispatch handoff,
  message patch replay, scriptstate projection dispatch, terminal
  restoration, terminal side effects, and generation-result persistence
  into `src/ts/process/serverBackedSendChat.ts`.
- Extracted the local prompt assembly wrapper into
  `src/ts/process/sendChatPromptAssembly.ts`, while keeping the existing
  focused prompt helper modules intact.
- Kept `sendChat` responsible for lifecycle wiring, context setup,
  local-versus-server path selection, dispatch/orchestration handoff,
  recursive continue/resend calls, and the `doingChat` ownership guard.
- Preserved existing server-backed command/projection-write behavior:
  patch replay still uses trusted projection writes, chat variable
  patches still dispatch scriptstate updates, terminal restoration still
  replays on provider failure, and generation results still persist
  after successful server-backed dispatch.

## Verification

Passed:

```bash
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts src/ts/process/__tests__/sendChatErrors.test.ts src/ts/process/__tests__/notification.test.ts src/ts/process/__tests__/igp.test.ts src/ts/process/__tests__/stage4Finalize.test.ts src/ts/process/__tests__/emotionFromResponse.test.ts src/ts/process/__tests__/charEmotionStore.test.ts src/ts/process/__tests__/emotionFallbackLlm.test.ts src/ts/process/__tests__/emotionFallbackEmbedding.test.ts src/ts/process/__tests__/imggenStableDiff.test.ts src/ts/process/__tests__/outputTrigger.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/finalizeRequestBudget.test.ts src/ts/process/__tests__/preflightTemplateTokens.test.ts src/ts/process/__tests__/buildDescription.test.ts src/ts/process/__tests__/buildPlainPromptSections.test.ts src/ts/process/__tests__/normalizeTemplate.test.ts src/ts/process/__tests__/buildStaticPromptSections.test.ts src/ts/process/__tests__/buildLorebookContext.test.ts src/ts/process/__tests__/formatHistoryMessage.test.ts src/ts/process/__tests__/buildHistoryWindow.test.ts src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/renderFinalPrompt.test.ts src/ts/process/__tests__/dispatchRequest.test.ts src/ts/process/__tests__/orchestrateResponse.test.ts src/ts/process/__tests__/runStage4.test.ts src/ts/process/__tests__/sendChatContext.test.ts
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
```

Results:

- Local Phase 5 helper/fixture sweep: 28 files, 316 tests passed.
- Server-backed sendChat fixture/preview sweep: 2 files, 26 tests
  passed.
- `pnpm check` still fails with the known broad alpha typecheck blocker:
  58 errors, 0 warnings, 18 files. The current failure list has no
  diagnostics in the new extracted sendChat helper files.

## Follow-Up

Phase 5 sendChat boundary drift is closed for this alpha pass. Continue
with the broad closeout typecheck blocker in
`../phases/broad-closeout-typecheck-alpha.md`, then rerun the full
closeout matrix after `pnpm check` passes.
