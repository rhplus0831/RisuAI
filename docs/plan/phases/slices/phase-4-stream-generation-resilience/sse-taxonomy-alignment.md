# SSE Taxonomy Alignment

Status: implemented on 2026-06-02.

## Source Anchors

- `server/fastify/src/prompt/sseEvents.ts`
- `server/fastify/src/routes/generationChat.ts`
- `src/ts/process/request/serverChatEvents.ts`
- `src/ts/process/request/serverChat.ts`

## Scope

Keep server-emitted chat SSE events and client parser/types aligned.

This slice is a contract/test hardening batch. It does not change runtime stream
behavior: it makes the server and client event-name vocabularies explicit,
types durable `job_accepted` on the client mirror, and adds tests that compare
the vocabularies plus prove unknown event tolerance remains intact.

Current reality:

- `server/fastify/src/prompt/sseEvents.ts` defines
  `PROMPT_CHAT_EVENT_TYPES`, including durable-only `job_accepted`.
- `src/ts/process/request/serverChatEvents.ts` defines the matching
  `CLIENT_PROMPT_CHAT_EVENT_TYPES` and includes `JobAcceptedEvent` in the public
  client `PromptChatEvent` union.
- `src/ts/process/request/serverChat.ts` parses `job_accepted`, prompt/info,
  token, side-effect, warning, error, and done frames, with reattach tests
  covering the replay path.
- Client tests compare the server and client vocabularies and prove generation
  streams continue to ignore unknown/future events and warning frames.

## Protocol Behavior

- Typed client coverage exists for every server-emitted chat SSE event.
- Event-name discriminators and JSON payload shapes stay mirrored through
  explicit server/client event-name constants.
- Unknown-event handling and durable `job_accepted` typing are covered by
  client tests.

## Done When

- Server and client SSE vocabularies are checked by tests.
- `job_accepted` and other lifecycle frames are typed and parsed consistently.
- Reattach frame replay from Phase 1 uses the same taxonomy.

## Validation

- `pnpm test -- src/ts/process/request/tests/durableGeneration.test.ts`
- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
