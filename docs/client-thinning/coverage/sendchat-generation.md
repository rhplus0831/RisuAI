# Chat Process And Generation Coverage

Date: 2026-05-29

## Current Proof

Provider routing and completion:

- `src/ts/process/request/tests/serverCompletion.test.ts`
- provider-specific tests under `server/fastify/__tests__/`

Server chat route and prompt assembly:

- `server/fastify/__tests__/generation.chat.test.ts`
- prompt helper tests under `server/fastify/__tests__/`

Browser/server bridge and post-generation:

- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `src/ts/process/__tests__/sendChat.serverPreview.test.ts`
- `src/ts/process/request/tests/serverChat.test.ts`
- `src/ts/process/__tests__/sendChatContext.test.ts`
- `src/ts/process/__tests__/command.projectionGuard.test.ts`

## Expected Coverage Shape

A chat-process batch (one blocker item) should prove:

- exact mode: `send`, `continue`, `preview`, `preview_prompt`, or `regenerate`
- the source branch removed or server-owned, OR the send classified `unsupported`
  (never a silent local fallback) — for **A1**, that a classifier returns
  `unsupported`/`server` (not `local`) in Fastify mode and `assembleLocalSendChatPrompt`
  is unreachable for the supported subset
- user/message rows created, updated, truncated, restored, or untouched
- command revision and active-writer behavior for any persisted mutation — for
  **C-A1**, zero outbound `patchChatScriptstate` POSTs for an assembly-time var
  write, and a non-active-writer `/chat` does not persist
- SSE frames and terminal behavior
- local restoration / rollback behavior
- browser-only side effects preserved (B1) or explicitly no-port
- provider unsupported shapes still fail explicitly in Fastify mode (**A3**)

## Known Gaps

- Server prompt assembly is opt-in via `useServerPromptAssembly` (default off);
  the classifier exists, but Lua hooks and image-gen instruction still route
  unsupported (**A1**).
- The output trigger and `editoutput` have no server path (**A2**).
- Final-message persistence still depends on a browser-issued command (**B2**,
  acceptable). Assembly-time scriptstate persistence is route-owned.
- Group chat is legacy and slated for client removal — not a coverage target.
