# Next Steps

Date: 2026-05-27

Use this file as the pickup runbook for the reopened alpha audit work.
The phase files under `../phases/` hold source evidence and exit
criteria.

Policy note: no actual Fastify users exist yet. Update current schemas,
commands, and import paths directly rather than preserving intermediate
Fastify shapes.

## Immediate Pickup

Pick one slice per work session. Each slice should leave the worktree in
a reviewable state with focused tests, update the affected phase file,
and add any longer closeout note under `../phases-completed/`.

Recommended order:

1. Clear the Phase 9 projection-write tails:
   [`../phases/phase-9-projection-write-tails-alpha.md`](../phases/phase-9-projection-write-tails-alpha.md).
   9A is closed, but character/chat/module import helpers, character
   ordering/chat selection, module apply, MCP `risuaccess`, and helper
   coverage still need a focused guard-enabled pass.
2. Clear the Phase 5 sendChat boundary drift:
   [`../phases/phase-5-sendchat-boundary-alpha.md`](../phases/phase-5-sendchat-boundary-alpha.md).
   The historical extraction closed, but the current coordinator has
   grown from the 445-line closeout shape to 703 lines after later
   server-backed adapter work.
3. Clear the broad closeout typecheck blocker:
   [`../phases/broad-closeout-typecheck-alpha.md`](../phases/broad-closeout-typecheck-alpha.md).
   Start with `pnpm check`; the 2026-05-27 closeout pass failed with 57
   diagnostics across 17 files while the rest of the closeout matrix
   passed.
4. After `pnpm check` passes, rerun broad alpha closeout verification.

Recently closed:

- Phase 8 - memory event delivery is now best-effort across external
  sinks, SSE subscribers, worker progress emits, and memory job routes.
- Phase 3 - hub passthrough responses now reuse the shared proxy
  response-header strip policy, with hub-only transport header stripping
  retained.
- Phase 6 truncated-tail slice - unterminated OpenAI-compatible,
  Anthropic, Mistral, and Gemini SSE tails now emit typed provider
  errors instead of successful `done` streams.
- Phase 6 SSE line-ending slice - OpenAI-compatible, Anthropic,
  Mistral, and Gemini stream parsers now accept CRLF-delimited SSE
  event blocks before truncated-tail detection.
- Phase 9A - converted the reopened projection-write blockers in
  module settings, `SideChatList`, Hypa/supa memory toggles, and
  lorebook page selection to command-first or draft-first flows. Phase
  9 is reopened for the 9B projection-write tails.

Latest broad closeout attempt on 2026-05-27:

- `pnpm check` failed: 57 errors, 0 warnings, 17 files.
- `pnpm test` passed: 67 files, 742 passed, 4 skipped.
- `pnpm api:test` passed: 68 files, 1212 passed.
- `pnpm build` passed with nonblocking build warnings.
- `pnpm smoke:fastify-browser` passed: 1 browser smoke test.

## Focused Verification

Phase 6 SSE line-ending handling (closed, re-run only for regression checks):

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.completion.test.ts server/fastify/__tests__/openai.test.ts server/fastify/__tests__/anthropic.test.ts server/fastify/__tests__/mistral.test.ts server/fastify/__tests__/gemini.test.ts
pnpm api:test -- server/fastify/__tests__/generation.completion.test.ts
```

Phase 5 sendChat boundary drift:

```bash
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts src/ts/process/__tests__/sendChatErrors.test.ts src/ts/process/__tests__/notification.test.ts src/ts/process/__tests__/igp.test.ts src/ts/process/__tests__/stage4Finalize.test.ts src/ts/process/__tests__/emotionFromResponse.test.ts src/ts/process/__tests__/charEmotionStore.test.ts src/ts/process/__tests__/emotionFallbackLlm.test.ts src/ts/process/__tests__/emotionFallbackEmbedding.test.ts src/ts/process/__tests__/imggenStableDiff.test.ts src/ts/process/__tests__/outputTrigger.test.ts src/ts/process/__tests__/nonStreamResponse.test.ts src/ts/process/__tests__/streamResponse.test.ts src/ts/process/__tests__/finalizeRequestBudget.test.ts src/ts/process/__tests__/preflightTemplateTokens.test.ts src/ts/process/__tests__/buildDescription.test.ts src/ts/process/__tests__/buildPlainPromptSections.test.ts src/ts/process/__tests__/normalizeTemplate.test.ts src/ts/process/__tests__/buildStaticPromptSections.test.ts src/ts/process/__tests__/buildLorebookContext.test.ts src/ts/process/__tests__/formatHistoryMessage.test.ts src/ts/process/__tests__/buildHistoryWindow.test.ts src/ts/process/__tests__/buildMemoryWindow.test.ts src/ts/process/__tests__/renderFinalPrompt.test.ts src/ts/process/__tests__/dispatchRequest.test.ts src/ts/process/__tests__/orchestrateResponse.test.ts src/ts/process/__tests__/runStage4.test.ts src/ts/process/__tests__/sendChatContext.test.ts
pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
pnpm check
```

Broad closeout typecheck blocker:

```bash
pnpm check
```

After the blocker is fixed, rerun the full closeout matrix:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
pnpm smoke:fastify-browser
```

Phase 3 (closed, re-run only for regression checks):

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts
pnpm api:test -- server/fastify/__tests__/hub.test.ts server/fastify/__tests__/proxy.test.ts
```

Phase 8 (closed, re-run only for regression checks):

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/memoryJobsRoutes.test.ts server/fastify/__tests__/memoryWorker.test.ts server/fastify/__tests__/events.test.ts
pnpm test -- src/ts/server/events.test.ts src/ts/bootstrap.test.ts src/ts/process/request/tests/serverMemory.test.ts
```

Phase 9 projection-write tails:

```bash
rg "bind:(value|check|list)=\\{DBState\\.db" src/lib src/ts
pnpm exec vitest run src/ts/bootstrap.test.ts src/ts/server/commands.test.ts src/ts/moduleCommands.test.ts src/ts/characterCommands.test.ts
pnpm api:test -- server/fastify/__tests__/commands.test.ts server/fastify/__tests__/events.test.ts server/fastify/__tests__/bootstrap.test.ts
pnpm smoke:fastify-browser
```

Broad closeout:

```bash
pnpm check
pnpm test
pnpm api:test
pnpm build
```

## References

- Current status: [`../status.md`](../status.md)
- Follow-up phase index: [`../phases/README.md`](../phases/README.md)
- Original Fastify status: `docs/fastify/status.md`
- Original Phase 9 command map:
  `docs/fastify/status/phase-9-command-map.md`
