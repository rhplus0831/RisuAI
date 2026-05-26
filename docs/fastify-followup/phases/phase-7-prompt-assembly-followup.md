# Phase 7 Follow-Up - Server-Side Prompt Assembly

Date: 2026-05-26

Status: reopened by audit.

## Goal

Close the remaining parity holes in server-side `/chat` prompt assembly
and dispatch.

## Audit Findings

- Server regenerate is declared but not implemented end to end.
  `src/ts/process/index.svelte.ts:250` selects only
  `preview_prompt`, `preview`, `continue`, or `send`. The route
  validates `regenerateMessageId` at
  `server/fastify/src/routes/generationChat.ts:87` and copies it at
  `server/fastify/src/routes/generationChat.ts:158`, but assembly only
  has the field in the input type at `server/fastify/src/prompt/assemble.ts:153`.
- Deferred/local providers are not guarded on `/chat`. Unknown
  OpenAI-compatible model IDs can fall through to OpenAI dispatch in
  `server/fastify/src/prompt/chatDispatch.ts:411` and
  `server/fastify/src/prompt/chatDispatch.ts:520`.
- Stop-trigger mutations are produced by assembly at
  `server/fastify/src/prompt/assemble.ts:1066` but the route emits only
  an error in the stop branch at
  `server/fastify/src/routes/generationChat.ts:352`.
- Server-backed fixture coverage seeds expected prompt snapshots instead
  of proving the real route handles continue and regenerate paths.

## Tasks

- Wire browser regenerate requests to `ServerChatInput.mode =
"regenerate"` and pass the target `regenerateMessageId`.
- Teach server assembly to consume `regenerateMessageId`, reconstruct the
  same transcript and mutation semantics as local regenerate, and reject
  invalid message IDs with the existing typed route error style.
- Add `/chat` provider dispatch guards for local-only or deferred
  providers, including NovelAI text, NovelList, Ooba OAI-compatible, and
  plugin/local provider families. They should either fall back to local
  client dispatch before server streaming begins or return an explicit
  unsupported-provider error.
- Emit `message_patch` and restoration metadata for stop-trigger aborts
  before the terminal error/done event.
- Replace mocked fixture expectations with route-backed coverage for at
  least send, continue, regenerate, preview, and preview-prompt.

## Session Slices

- 7A - Browser regenerate request wiring. Teach the client server-backed
  send path to send `mode: "regenerate"` with `regenerateMessageId`, and
  add focused client tests for the request shape. Stop before changing
  assembly semantics if that becomes large.
- 7B - Server regenerate assembly semantics. Consume
  `regenerateMessageId` in assembly, reconstruct the local regenerate
  transcript/mutation behavior, and reject invalid message IDs with the
  existing typed route error style.
- 7C - `/chat` provider dispatch guards. Block local-only or deferred
  provider families from falling through to OpenAI-compatible dispatch,
  covering NovelAI text, NovelList, Ooba OAI-compatible, plugin, and
  local provider families.
- 7D - Stop-trigger mutation payload delivery. Ensure route streaming
  emits the assembly-produced `message_patch` and restoration metadata
  before the terminal error or done frame.
- 7E - Route-backed fixture coverage. Replace seeded prompt snapshots
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
pnpm test -- src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts
```

## References

- Original phase: `docs/fastify/phases/phase-7-prompt-assembly.md`
- sendChat server mode selection: `src/ts/process/index.svelte.ts:250`
- regenerate route validation: `server/fastify/src/routes/generationChat.ts:87`
- regenerate route copy: `server/fastify/src/routes/generationChat.ts:158`
- assembly input type: `server/fastify/src/prompt/assemble.ts:153`
- provider fallback: `server/fastify/src/prompt/chatDispatch.ts:411`
- stop-trigger return payload: `server/fastify/src/prompt/assemble.ts:1066`
- stop-trigger route branch: `server/fastify/src/routes/generationChat.ts:352`
