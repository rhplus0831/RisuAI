# Slice: Transport Abort Contract

Phase: [1](../../phase-1-high-and-send-path.md). Depends on the Phase 0
terminal-frame helper and v3 gate registry. Runtime change.

## Scope

Restore the provider transport abort contract for H1: when the request signal
is aborted, `emitProviderChunks` must return `{ status: 'aborted', result }`
without emitting a success terminal frame, running side effects, or running
post-generation persistence. Cover the durable streaming cancel paths and the
silent-return non-streaming `resultFrames` arm.

## Anchors

- `server/fastify/src/prompt/providerTransport.ts`:
  `emitProviderChunks`, `emitSuccessDone`, in-loop terminal emit, post-loop
  fallthrough.
- `server/fastify/src/prompt/chatDispatch.ts`: `resultFrames` and provider
  dispatch arms that wrap non-streaming results.
- Silent-return streaming adapters under `server/fastify/src/generation/`,
  especially OpenAI, Anthropic, Gemini, Mistral, Ollama, and Echo.
- `server/fastify/src/routes/generationChat.ts`:
  `buildDurablePostGeneration`, `persistRawCancelledResult`, and the durable
  `transportResult.status === 'aborted'` branch.
- `server/fastify/__tests__/generation.chat.test.ts` plus the Phase 0
  terminal-frame assertion helper.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  `docs/plan/active-risk-analysis.md` for H1 gate registration.

## Target Shape

- In `emitProviderChunks`, re-check `signal?.aborted` immediately before the
  in-loop success terminal emit. If aborted, return `{ status: 'aborted',
  result }` and emit nothing else from the transport helper.
- Guard the post-loop fallthrough the same way before `emitSuccessDone()`.
  This is the common silent-generator-return path for streaming adapters and
  also covers `resultFrames` when a non-streaming provider reports abort by
  returning no frames under the aborted signal.
- Keep the existing durable route recovery branch. It may emit a terminal
  `done` for reattached observers, but that terminal must be produced by the
  durable abort branch and must not include `postGeneration` success metadata.
- Do not add new machinery for the inline `streamAssembly` arm; it is dead on
  the live Fastify runtime. The shared transport guard is still allowed to
  protect it because both callers use `emitProviderChunks`.
- Keep error behavior unchanged: provider errors still emit `error` followed
  by terminal `done`, with restoration metadata when available.
- Register H1 as `DONE` in the v3 gate with the durable-cancel regression
  test path/name, and flip only the H1 row in `active-risk-analysis.md` in the
  same change.

## Invariants

- Abort never calls `sideEffects` or `postGeneration`.
- Abort returns the accumulated partial result so `persistRawCancelledResult`
  can preserve the raw cancelled text when it exists.
- A normal provider `done` frame still emits exactly one success terminal
  `done`.
- A provider `error` frame or thrown provider error keeps its existing
  terminal sequence.
- The transport helper itself emits nothing after observing abort; any terminal
  event for a reattached durable observer is owned by `generationChat.ts`.

## Done Criteria

- Explicit durable cancel (`DELETE /api/v1/generate/chat/:id`) receives the
  abort-shaped terminal path: no success `done` from `emitProviderChunks`, no
  `postGeneration`, no output-trigger run, and no scriptstate persistence from
  the cancelled turn.
- Sliding-deadline abort has the same assertions as explicit cancel.
- A narrow race test aborts after token emission but before a provider terminal
  frame and proves the in-loop re-check wins.
- A non-streaming `resultFrames`-style silent return under an aborted signal
  returns `status: 'aborted'` rather than falling through to success.
- H1 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run server/fastify/__tests__/generation.chat.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm api:test
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```
