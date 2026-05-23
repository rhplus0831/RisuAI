# Test Coverage

Date: 2026-05-24

This is the coverage router. Detail per area lives in the
shards under [`coverage/`](coverage/).

## Snapshot

- Phase 4 `sendChat` characterization tests exist at
  `src/ts/process/__tests__/sendChat.fixtures.test.ts`, with 38
  fixture sets under `src/ts/process/__fixtures__/` (17 initial
  Phase 4 fixtures, nine Phase 5 gate fixtures, plus the
  Phase 6 `echo-basic`, `openai-basic`, `anthropic-basic`,
  `mistral-basic`, `cohere-basic`, `deepseek-basic`,
  `gemini-basic`, `gemini-vertex-basic`, `bedrock-basic`,
  `horde-basic`, `mistral-reverse-proxy-basic`, and
  `anthropic-reverse-proxy-basic` provider fixtures). The twelve
  Phase 6 fixtures also run through
  `sendChat.fixtures.serverBacked.test.ts`.
- Phase 5 extraction slices added focused process tests for the
  helper modules that now sit beside the fixture harness:
  `sendChatErrors.test.ts`, `notification.test.ts`, `igp.test.ts`,
  `stage4Finalize.test.ts`, `emotionFromResponse.test.ts`,
  `charEmotionStore.test.ts`, `emotionFallbackLlm.test.ts`,
  `emotionFallbackEmbedding.test.ts`, `imggenStableDiff.test.ts`,
  `outputTrigger.test.ts`, `nonStreamResponse.test.ts`,
  `streamResponse.test.ts`, `finalizeRequestBudget.test.ts`,
  `preflightTemplateTokens.test.ts`, `buildDescription.test.ts`,
  `buildPlainPromptSections.test.ts`, `normalizeTemplate.test.ts`,
  `buildStaticPromptSections.test.ts`, `buildLorebookContext.test.ts`,
  `formatHistoryMessage.test.ts`, `buildHistoryWindow.test.ts`,
  `buildMemoryWindow.test.ts`, `renderFinalPrompt.test.ts`,
  `dispatchRequest.test.ts`, `orchestrateResponse.test.ts`,
  `runStage4.test.ts`, and `sendChatContext.test.ts`.
- Existing helper-surface tests continue to cover smaller process
  seams outside the fixture harness. Relevant current files include
  `src/ts/process/ttsHooks.test.ts`,
  `src/ts/process/request/tests/additionalParams.test.ts`,
  `src/ts/process/request/tests/serverCompletion.test.ts`,
  `src/ts/process/mcp/risuaccess/tests/modules.test.ts`, and
  `src/ts/process/files/tests/inlays.test.ts`; broader repo tests
  cover parser, media, translator, network, and source-map helpers.
- `server/fastify/__tests__/smoke.test.ts` covers the Phase 1
  Fastify foundation. `bootstrap.test.ts`, `assets.test.ts`,
  `backups.test.ts`, and `static.test.ts` cover the Phase 2
  server storage routes and static SPA serving. `proxy.test.ts`,
  `streamJobs.test.ts`, `streamJobsRoutes.test.ts`, `hub.test.ts`,
  and `legacyStorage.test.ts` cover the Phase 3 proxy / hub /
  stream-job / legacy storage surface. `generation.completion.test.ts`,
  `echo.test.ts`, `openai.test.ts`, `additionalParams.test.ts`,
  `anthropic.test.ts`, `mistral.test.ts`, `cohere.test.ts`,
  `gemini.test.ts`, `vertexAuth.test.ts`,
  `openaiLegacyInstruct.test.ts`, `openaiResponses.test.ts`,
  `kobold.test.ts`, `oobaLegacy.test.ts`, `ollama.test.ts`,
  `bedrock.test.ts`, `sigv4.test.ts`, and `horde.test.ts` cover
  the closed Phase 6 completion-route providers through
  `pnpm api:test`.
- Phase 7 has `/chat` and `/preview-prompt` route coverage in
  `generation.chat.test.ts`, prompt leaf coverage in
  `promptVariables.test.ts`, `staticSections.test.ts`,
  `plainSections.test.ts`, `history.test.ts`, `scripts.test.ts`,
  `modules.test.ts`, `lorebook.test.ts`, `tokens.test.ts`,
  `preflight.test.ts`, `budgetFinalize.test.ts`, `triggers.test.ts`,
  `templates.test.ts`, `memory.test.ts`, and `assemble.test.ts`, plus
  browser adapter / preview wiring coverage in `serverChat.test.ts`,
  `sseParse.test.ts`, and `sendChat.serverPreview.test.ts`.

## Where to look

| Concern                                           | Open                                                           |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `sendChat` characterization fixtures (Phases 4-5) | [coverage/sendchat-fixtures.md](coverage/sendchat-fixtures.md) |
| Fastify route tests (Phases 1-3, 6-9)             | [coverage/server-routes.md](coverage/server-routes.md)         |
| Per-provider generation tests (Phase 6)           | [coverage/providers.md](coverage/providers.md)                 |

## Verification commands

```bash
pnpm check          # svelte-check + tsc
pnpm test           # frontend vitest (existing)
pnpm api:test       # Fastify vitest route suite
pnpm build          # production bundle
```

Run `pnpm check`, `pnpm test`, and `pnpm build` before closing a
browser-only slice. Include `pnpm api:test` for Fastify server slices.

## Maintenance

- Every fixture added to the sendChat suite gets a row in
  [`coverage/sendchat-fixtures.md`](coverage/sendchat-fixtures.md)
  with one line about what it pins.
- Every new server route gets a row in
  [`coverage/server-routes.md`](coverage/server-routes.md) once
  the route has a test.
- Every new provider in `/api/v1/generate/completion` gets a row
  in [`coverage/providers.md`](coverage/providers.md).
- Coverage rows are not deleted when work lands; they document
  what is pinned.
