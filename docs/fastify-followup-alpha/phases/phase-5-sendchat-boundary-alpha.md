# Phase 5 Alpha Follow-Up - sendChat Boundary Drift

Date: 2026-05-27

Status: closed. Closeout log:
[`../phases-completed/phase-5-sendchat-boundary-alpha.md`](../phases-completed/phase-5-sendchat-boundary-alpha.md).

## Goal

Restore the current `sendChat` coordinator boundary after later
server-backed prompt-assembly and projection-write slices added new
adapter logic directly to `src/ts/process/index.svelte.ts`.

This does not reopen the historical Phase 5 extraction. The original
Phase 5 closeout is still supported by commit `a7e2831d`, where the
coordinator was 445 lines and the browser extraction fixtures were
green. The alpha finding is that the current tree no longer matches the
same thin-coordinator shape.

## Audit Finding

The 2026-05-27 alpha re-audit found:

- `src/ts/process/index.svelte.ts` is currently 703 lines.
- `git show a7e2831d:src/ts/process/index.svelte.ts | wc -l` reports
  445 lines at the Phase 5 closeout commit.
- `git diff --shortstat a7e2831d -- src/ts/process/index.svelte.ts`
  reports 533 insertions and 275 deletions since the closeout.
- The growth is concentrated in server-backed sendChat adapter logic:
  request mode selection, `/chat` prompt and generation calls, message
  patch replay, scriptstate projection dispatch, server terminal
  side-effects, provider error restoration, and generation-result
  persistence.
- The original Phase 5 helper modules and local fixtures still pass, so
  this is a boundary drift cleanup rather than a known behavior
  regression.
- At re-audit time, the broad alpha `pnpm check` blocker included
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
  typing diagnostics. That blocker is now closed by the broad
  typecheck cleanup.

## Closed Scope

The alpha boundary cleanup landed on 2026-05-27. Keep any detailed
slice notes in the completed closeout log linked above.

## Tasks

- Extract the current server-backed sendChat adapter path out of
  `src/ts/process/index.svelte.ts` into focused browser-side helpers.
  Keep the coordinator responsible for lifecycle wiring, stage handoffs,
  recursive continuation/resend calls, and choosing local versus
  server-backed paths.
- Preserve existing command/projection-write ownership. Keep
  `withTrustedServerProjectionWrite`, scriptstate patch dispatch,
  restoration replay, terminal side-effects, and generation-result
  persistence behavior equivalent.
- Keep behavior changes minimal. Do not move new logic server-side in
  this slice; Phases 6-9 own server behavior.
- Add or adjust focused tests only where the extracted helpers expose a
  stable contract that is not already covered by the local or
  server-backed sendChat fixture suites.
- If the refactor exposes an actual behavior regression, document that
  separately before widening this scope.

## Boundaries

- Do not rewrite prompt assembly, provider dispatch, memory, or command
  route behavior as part of this cleanup.
- Do not re-record fixtures for structural refactoring alone.
- Do not add compatibility migrations for intermediate Fastify shapes.
- Do not turn this doc into a long work log. Move landed closeout detail
  to `../phases-completed/` after the slice closes.

## Exit Criteria

- `src/ts/process/index.svelte.ts` is back under 500 lines or the
  remaining overage is justified by a documented, current coordinator
  responsibility.
- The server-backed sendChat adapter logic has focused helper
  boundaries rather than living as a large inline block in the
  coordinator.
- Local Phase 5 helper and fixture coverage passes.
- Server-backed sendChat fixture and preview coverage passes.
- `pnpm check` has no sendChat-boundary diagnostics. Broader unrelated
  diagnostics may remain only if the broad closeout typecheck slice is
  still open and explicitly tracks them.

## Verification

```bash
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts src/ts/process/__tests__/sendChatErrors.test.ts src/ts/process/__tests__/notification.test.ts src/ts/process/__tests__/igp.test.ts src/ts/process/__tests__/stage4Finalize.test.ts src/ts/process/__tests__/emotionFromResponse.test.ts src/ts/process/__tests__/charEmotionStore.test.ts src/ts/process/__tests__/emotionFallbackLlm.test.ts src/ts/process/__tests__/emotionFallbackEmbedding.test.ts src/ts/process/__tests__/imggenStableDiff.test.ts src/ts/process/__tests__/outputTrigger.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/finalizeRequestBudget.test.ts src/ts/process/__tests__/preflightTemplateTokens.test.ts src/ts/process/__tests__/buildDescription.test.ts src/ts/process/__tests__/buildPlainPromptSections.test.ts src/ts/process/__tests__/normalizeTemplate.test.ts src/ts/process/__tests__/buildStaticPromptSections.test.ts src/ts/process/__tests__/buildLorebookContext.test.ts src/ts/process/__tests__/formatHistoryMessage.test.ts src/ts/process/__tests__/buildHistoryWindow.test.ts src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/renderFinalPrompt.test.ts src/ts/process/__tests__/dispatchRequest.test.ts src/ts/process/__tests__/orchestrateResponse.test.ts src/ts/process/__tests__/runStage4.test.ts src/ts/process/__tests__/sendChatContext.test.ts
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
pnpm check
```

## Verification From Audit

The 2026-05-27 re-audit ran:

- `pnpm exec vitest run ...` for the local Phase 5 fixture/helper set:
  passed, 28 files and 316 tests.
- `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts`:
  passed, 2 files and 26 tests.
- `pnpm check`: now passes after the broad alpha typecheck cleanup. The
  earlier blocker had no diagnostics in the extracted sendChat helper
  files.
