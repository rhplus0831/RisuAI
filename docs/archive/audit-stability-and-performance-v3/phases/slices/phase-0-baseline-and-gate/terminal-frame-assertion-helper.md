# Slice: Terminal-Frame Assertion Helper

Phase: [0](../../phase-0-baseline-and-gate.md). No runtime change.

## Scope

Add a shared test helper for collecting `/generate/chat` SSE and durable-job
frames and asserting terminal kind/order. This is the proof surface Phase 1 H1
will use to show an aborted provider stream does not emit a success terminal
`done` or run success-only post-generation work over truncated text.

## Anchors

- Server route tests:
  `server/fastify/__tests__/generation.chat.test.ts` (`parseEvents`,
  provider-transport failure tests, durable generation tests).
- Client SSE parser tests:
  `src/ts/process/request/tests/sseParse.test.ts`.
- Server terminal taxonomy:
  `server/fastify/src/prompt/sseEvents.ts`.
- Provider transport:
  `server/fastify/src/prompt/providerTransport.ts` (`emitProviderChunks`).
- Durable chat jobs:
  `server/fastify/src/generationJobs.ts`,
  `server/fastify/src/routes/generationChat.ts`.

## Target Shape

- Add a server-test helper, for example
  `server/fastify/__tests__/helpers/terminalFrameAssertions.ts`.
- Centralize the local `parseEvents(body: string)` shape from
  `generation.chat.test.ts` into a reusable parser that returns ordered typed
  frames: `{ type, data }`.
- Provide assertions for terminal behavior, for example:
  `expectFrameOrder(events, [...])`,
  `expectSingleTerminal(events)`,
  `expectTerminalDone(events)`,
  `expectTerminalErrorThenDone(events)`, and
  `expectNoSuccessDoneAfterAbort(events)`.
- Support both inline route responses and durable-job replay buffers. The helper
  should accept a raw Fastify `res.body` string and also plain frame arrays so
  Phase 1 can use it in lower-level transport tests if that is cleaner.
- Add a focused helper smoke test with synthetic frame arrays that proves the
  helper fails on duplicate terminals, success `done` after an abort-shaped
  stream, and out-of-order terminal frames.

## Invariants

- No production code changes and no route behavior changes in this slice.
- The helper should assert event order and event kind, not exact full payloads
  unless a caller asks for that.
- Existing success and provider-error terminal semantics remain valid:
  provider errors may emit `error` then a bare terminal `done`; H1 only changes
  aborted streams that currently fall through to a success terminal.
- Keep helper failures readable enough that later H1 tests identify the
  unexpected frame sequence directly.

## Done Criteria

- Existing generation chat route tests can import the helper without changing
  their assertions' meaning.
- The helper smoke test fails for malformed terminal sequences and passes for
  the current success and error-then-done sequences.
- Phase 1 H1 has a reusable assertion to prove "cancelled generation did not
  emit a success `done`".

## Validation

```bash
pnpm exec vitest run server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/terminalFrameAssertions.test.ts
```
