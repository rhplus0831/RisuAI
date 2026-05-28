# sendChat Thinning

Date: 2026-05-28

Read this when a client-thinning batch touches chat submission, prompt assembly,
server chat SSE, provider routing, generation result persistence, or
post-generation browser branches.

## Implemented

- Fastify mode routes supported provider dispatch through
  `resolveServerCompletionRoute()` and `/api/v1/generate/completion`.
- `/api/v1/generate/chat` validates chat intent, assembles prompts, emits chat
  SSE frames, and can dispatch the provider when server prompt assembly is
  enabled.
- The browser has a server-backed adapter in
  `src/ts/process/serverBackedSendChat.ts`.
- Server-backed sendChat can apply server message patches, scriptstate patch
  commands, Hypa V3 progress, and terminal payloads.

## Bounded Or Partial

- `DefaultChatScreen.svelte::sendMain` still handles slash commands, file inlay
  text insertion, say-nothing rows, input triggers, editinput scripts, local
  transcript replacement, reroll trimming, and abort setup before calling
  `sendChat`.
- `src/ts/process/index.svelte.ts::sendChat` still owns the busy lock, local
  prompt fallback, dispatch handoff, response orchestration, recursive
  continue/resend, stage 4, and final persistence.
- `src/ts/process/sendChatPromptAssembly.ts` remains the local prompt assembly
  fallback.
- `src/ts/process/serverBackedSendChat.ts` still replays some server-detected
  chat variable/scriptstate mutations through browser command helpers.
- `src/ts/process/postGeneration/runStage4.ts` still owns browser notification,
  emotion fallback, image generation, resend, and final stage metadata.

## Candidate Batches

- Move durable input/user-message creation into the server chat route or a
  command transaction for one supported send shape.
- Make server prompt assembly mandatory for a documented supported subset and
  retire the matching local fallback.
- Persist server-detected chat-variable/scriptstate mutations inside
  `/generate/chat` instead of returning browser command replay patches.
- Persist assistant generation result server-side for one supported generation
  mode.
- Split one post-generation branch into server-durable text mutation versus
  browser-only effect.

## Non-Targets

- Do not port browser UI/display ownership.
- Do not widen provider support while removing prompt/post-generation branches.
- Do not combine input-row persistence, prompt defaulting, and stage 4 thinning
  in one batch.

## Proof Leads

- `server/fastify/__tests__/generation.chat.test.ts`
- `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`
- `src/ts/process/request/tests/serverCompletion.test.ts`
- `src/ts/process/__tests__/command.projectionGuard.test.ts`
- `src/ts/process/__tests__/sendChatContext.test.ts`
- focused command route/helper tests for any persistence change
