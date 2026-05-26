# Phase 7 Follow-Up - Server-Side Prompt Assembly

Date: 2026-05-27

Status: closed. Slices 7A-7E have landed.

## Goal

Keep the closed server-side `/chat` prompt assembly contract visible:
regenerate, provider guards, stop-trigger mutations, and route-backed
fixture coverage now match the codebase.

## Closure Summary

- Browser regenerate requests send `mode: "regenerate"` with
  `regenerateMessageId`; server assembly consumes it, truncates the
  transcript, and emits a `regenerate` `message_patch`.
- `/chat` now rejects local-only or deferred provider families before
  dispatch, including NovelAI text, NovelList, Ooba OAI-compatible,
  plugin, local WebLLM, and unknown OpenAI-compatible model ids.
- Stop-trigger aborts emit assembly-produced `message_patch` data and
  restoration metadata before the terminal error.
- Server-backed fixture coverage exercises the real Fastify `/chat`
  route for send, continue, regenerate, preview, and preview-prompt.

## Completed Slices

| Slice | Commit     | Scope                                   |
| ----- | ---------- | --------------------------------------- |
| 7A    | `e49d21de` | Browser regenerate request wiring.      |
| 7B    | `9b9b09e8` | Server regenerate assembly semantics.   |
| 7C    | `6919310d` | `/chat` provider dispatch guards.       |
| 7D    | `5eb73446` | Stop-trigger mutation payload delivery. |
| 7E    | `e7425ab1` | Route-backed fixture coverage.          |

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
- reroll caller wiring: `src/lib/ChatScreens/DefaultChatScreen.svelte:330`
- browser request adapter tests: `src/ts/process/request/tests/serverChat.test.ts`
- sendChat request-shape tests: `src/ts/process/__tests__/sendChat.serverPreview.test.ts`
- regenerate route validation: `server/fastify/src/routes/generationChat.ts:87`
- regenerate route copy: `server/fastify/src/routes/generationChat.ts:158`
- regenerate transcript prep: `server/fastify/src/prompt/assemble.ts:532`
- unsupported provider guard: `server/fastify/src/prompt/chatDispatch.ts:450`
- provider dispatch guard call: `server/fastify/src/prompt/chatDispatch.ts:647`
- stop-trigger return payload: `server/fastify/src/prompt/assemble.ts:1113`
- stop-trigger route branch: `server/fastify/src/routes/generationChat.ts:353`
