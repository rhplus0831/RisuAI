# sendChat And Generation Coverage

Date: 2026-05-28

## Current Proof

Provider routing and completion:

- `src/ts/process/request/tests/serverCompletion.test.ts`
- provider-specific tests under `server/fastify/__tests__/`

Server chat route and prompt assembly:

- `server/fastify/__tests__/generation.chat.test.ts`
- prompt helper tests under `server/fastify/__tests__/`

Browser/server bridge:

- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `src/ts/process/__tests__/sendChat.serverPreview.test.ts`
- `src/ts/process/request/tests/serverChat.test.ts`
- `src/ts/process/__tests__/sendChatContext.test.ts`

Post-generation leads:

- tests under `src/ts/process/__tests__/` for stream/non-stream response,
  IGP, and stage-specific helpers

## Expected Coverage Shape

sendChat thinning changes should prove:

- exact mode: `send`, `continue`, `preview`, `preview_prompt`, or
  `regenerate`
- source branch removed or server-owned
- user/message rows created, updated, truncated, restored, or left untouched
- command revision and active-writer behavior for any persisted mutation
- SSE frames and terminal behavior
- local restoration or rollback behavior
- browser-only side effects preserved or explicitly no-port
- provider unsupported shapes still fail explicitly in Fastify mode

## Known Gaps

- Server prompt assembly is opt-in through `useServerPromptAssembly`.
- Local prompt assembly and post-generation browser branches remain production
  paths.
- Server-backed mutation persistence still depends on browser command replay in
  some paths.
