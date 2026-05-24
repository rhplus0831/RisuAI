# Phase 7 Prompt Assembly - Closeout

Date: 2026-05-24

Phase 7 is closed. The final pass verified that server-side prompt
assembly covers send-like and preview paths behind
`db.useServerPromptAssembly`, and that the `/chat` SSE taxonomy is pinned
for the browser adapter.

## Confirmed

- `send`, `continue`, and `regenerate` route through the server prompt
  assembly mode contract, with route validation covering required payload
  differences and server-backed fixture coverage proving send-like calls
  do not fall back to `/api/v1/generate/completion`.
- `preview` and `preview-prompt` use `/api/v1/generate/chat` in
  server-backed mode; `preview` fills `previewFormated`, and
  `preview-prompt` fills `previewBody`.
- `/chat` SSE coverage includes stage events, prompt metadata,
  `message_patch`, `info`, provider `token`, terminal `error`, typed TTS
  `side_effect`, restoration payloads, and enriched terminal `done`
  metadata.
- Browser adapter coverage confirms terminal side effects and restoration
  payloads are consumed through the existing `sendChat` closeout and
  error-reporting paths.

## Deferred

- Hypa V3 memory moves to Phase 8.
- Client thinning moves to Phase 9.
- Image generation, Stable Diffusion, plugin / Lua hooks, NovelAI text,
  NovelList, and Ooba OAI-compatible string flattening remain deferred.
- Hub-route session auth remains a parallel watch point.

## Verification

- `pnpm exec vitest run server/fastify/__tests__/generation.chat.test.ts --config server/fastify/vitest.config.ts`
  - 23 tests passed.
- `pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/request/tests/serverMessagePatch.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts`
  - 44 tests passed.
- `pnpm check` - clean.
- `pnpm test` - 639 tests passed, 4 skipped.
- `pnpm api:test` - 895 tests passed.
- `pnpm build` - passed with existing CSS `::highlight`, browser
  externalization, plugin-timing, and bundle-size warnings.

## Next Pickup

Start Phase 8 at **8-1a-i - Migration runner + version bump**. Keep
memory table DDL, repositories, workers, routes, provider calls, and
browser memory UI out of that first slice.
