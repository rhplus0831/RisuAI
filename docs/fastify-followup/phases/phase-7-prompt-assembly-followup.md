# Phase 7 Follow-Up - Server-Side Prompt Assembly

Date: 2026-05-27

Status: closed. Slices 7A-7E have landed.

## Goal

Close the remaining parity holes in server-side `/chat` prompt assembly
and dispatch.

## Audit Findings

- Server regenerate was completed in Slice 7B. Browser regenerate
  requests send `mode: "regenerate"` with a target
  `regenerateMessageId`, and server assembly now consumes the target to
  truncate the transcript and emit a `regenerate` `message_patch`.
- Deferred/local providers are not guarded on `/chat`. Unknown
  OpenAI-compatible model IDs can fall through to OpenAI dispatch in
  `server/fastify/src/prompt/chatDispatch.ts:407` and model strings for
  custom reverse-proxy paths still flatten at
  `server/fastify/src/prompt/chatDispatch.ts:967`.
- Stop-trigger mutation delivery was completed in Slice 7D. The route
  now emits the assembly-produced `message_patch` and restoration
  metadata before the terminal stop-trigger error.
- Server-backed fixture coverage now exercises a real Fastify `/chat`
  route for send, continue, regenerate, preview, and preview-prompt.

## Tasks

- Done in 7A: wire browser regenerate requests to
  `ServerChatInput.mode = "regenerate"` and pass the target
  `regenerateMessageId`.
- Done in 7B: teach server assembly to consume `regenerateMessageId`,
  reconstruct the same transcript and mutation semantics as local
  regenerate, and reject invalid latest-message targets with the
  existing typed route error style.
- Done in 7C: add `/chat` provider dispatch guards for local-only or
  deferred providers, including NovelAI text, NovelList, Ooba
  OAI-compatible, plugin, local provider families, and unknown
  OpenAI-compatible model ids. These now return explicit
  unsupported-provider SSE errors instead of falling through to OpenAI
  dispatch.
- Done in 7D: emit `message_patch` and restoration metadata for
  stop-trigger aborts before the terminal error/done event, and keep
  the browser adapter replay path visible before surfacing the error.
- Done in 7E: replace mocked fixture expectations with route-backed
  coverage for send, continue, regenerate, preview, and preview-prompt.

## Session Slices

- 7A - Landed: browser regenerate request wiring. Taught the client server-backed
  send path to send `mode: "regenerate"` with `regenerateMessageId`, and
  added focused client tests for the request shape. Server assembly
  semantics are intentionally left for 7B.
- 7B - Landed: server regenerate assembly semantics. Assembly consumes
  `regenerateMessageId`, truncates the latest assistant response using
  local reroll semantics, emits a `regenerate` `replace_all`
  `message_patch`, and tolerates the browser-command race where the
  persisted transcript is already truncated.
- 7C - Landed: `/chat` provider dispatch guards. Blocked local-only or
  deferred provider families from falling through to OpenAI-compatible
  dispatch, covering NovelAI text, NovelList, Ooba OAI-compatible,
  plugin, local provider families, and unknown OpenAI-compatible model
  ids.
- 7D - Landed: stop-trigger mutation payload delivery. Route streaming
  emits the assembly-produced `message_patch` and restoration metadata
  before the terminal stop-trigger error, and the browser adapter keeps
  pre-error patches available so `sendChat` can replay them before
  reporting the abort.
- 7E - Landed: route-backed fixture coverage. Replaced seeded prompt snapshots
  with real Fastify route-backed fixture coverage for send, continue,
  regenerate, preview, and preview-prompt.

## Exit Criteria

- Regenerate works through server prompt assembly and provider dispatch
  when `db.useServerPromptAssembly` is true.
- Deferred provider families cannot accidentally dispatch through the
  wrong OpenAI-compatible path.
- Stop-trigger chat mutations are visible to the browser even when
  assembly aborts.
- Fixture tests exercise real Fastify route behavior for the paths they
  claim to cover.

## Verification

```bash
pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/assemble.test.ts server/fastify/__tests__/providerTransport.test.ts
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts src/ts/process/__tests__/sendChat.serverPreview.test.ts
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
```

## References

- Original phase: `docs/fastify/phases/phase-7-prompt-assembly.md`
- sendChat server mode selection: `src/ts/process/index.svelte.ts:250`
- reroll caller wiring: `src/lib/ChatScreens/DefaultChatScreen.svelte:263`
- browser request adapter tests: `src/ts/process/request/tests/serverChat.test.ts`
- sendChat request-shape tests: `src/ts/process/__tests__/sendChat.serverPreview.test.ts`
- regenerate route validation: `server/fastify/src/routes/generationChat.ts:87`
- regenerate route copy: `server/fastify/src/routes/generationChat.ts:158`
- assembly input type: `server/fastify/src/prompt/assemble.ts:153`
- provider fallback: `server/fastify/src/prompt/chatDispatch.ts:407`
- custom reverse-proxy model string: `server/fastify/src/prompt/chatDispatch.ts:967`
- stop-trigger return payload: `server/fastify/src/prompt/assemble.ts:1066`
- stop-trigger route branch: `server/fastify/src/routes/generationChat.ts:352`
