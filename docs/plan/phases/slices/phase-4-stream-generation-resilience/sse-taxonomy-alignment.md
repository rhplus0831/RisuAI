# SSE Taxonomy Alignment

Status: planned.

## Source Anchors

- `server/fastify/src/prompt/sseEvents.ts`
- `server/fastify/src/routes/generationChat.ts`
- `src/ts/process/request/serverChatEvents.ts`
- `src/ts/process/request/serverChat.ts`

## Scope

Keep server-emitted chat SSE events and client parser/types aligned. The route
emits `job_accepted`; the client must understand every event needed for durable
generation lifecycle and reattach behavior.

## Protocol Behavior

- Add or verify typed client coverage for every server-emitted chat SSE event.
- Keep event-name discriminators and JSON payload shapes mirrored.
- Add tests for unknown-event handling and required known events.

## Done When

- Server and client SSE vocabularies are checked by tests or shared fixtures.
- `job_accepted` and other lifecycle frames are typed and parsed consistently.
- Reattach frame replay from Phase 1 uses the same taxonomy.

## Validation

- `pnpm test -- src/ts/process/request/tests/durableGeneration.test.ts`
- `pnpm api:test -- server/fastify/__tests__/durableGeneration.test.ts`
