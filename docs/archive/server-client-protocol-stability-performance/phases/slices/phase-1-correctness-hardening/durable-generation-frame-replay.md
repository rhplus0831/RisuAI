# Durable Generation Frame Replay

Status: implemented.

## Source Anchors

- `server/fastify/src/streamJobs.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/generationJobs.ts`
- `src/ts/process/request/serverChat.ts`

## Scope

Make durable generation reattach replay required lifecycle frames independent of
viewer count. Before this slice, the shared buffer could omit `prompt` and
`info` after an attached viewer saw them and disconnected.

## Protocol Behavior

- Retain or reconstruct `job_accepted`, `prompt`, latest `info`, message
  patches, side effects needed for client state, token tail or result text, and
  terminal frames for the job lifetime.
- Keep reattach using the same SSE parser and event taxonomy.
- Do not claim process-restart survival for in-flight provider streams in this
  slice.

## Done When

- A reattached client can reach ready state even after the first viewer received
  `prompt` and `info`.
- `done` without prior required frames is no longer a normal reattach outcome.
- Tests cover disconnect after `prompt`/`info` and later reattach.

## Implementation Notes

- Durable chat generation jobs enable a replay log on `JobRegistry` while proxy
  stream jobs continue to use connection-gap pending buffers.
- Reattach reconstructs `job_accepted` at viewer attach time and replays the
  retained prompt/chat SSE frames through the existing event taxonomy.
- Replay keeps the latest `info` frame and protects lifecycle/state frames while
  trimming droppable stage/token tail frames under the existing pending limits.

## Validation

- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
- `pnpm test -- src/ts/process/request/tests/durableGeneration.test.ts`
