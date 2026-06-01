# Generation Prompt Side-Effect Measurement

Status: implemented on 2026-06-01.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/src/protocolMetrics.ts`

## Scope

Measure remaining generation and prompt-assembly whole-corpus costs before
choosing another narrow write path.

Selected batch:

- Add opt-in `generation_prompt_assembly` protocol metrics around server prompt
  assembly for inline chat generation, durable chat generation, and
  preview-prompt requests.
- Track database load/hydration count and duration inside the route-bound
  assembler dependency surface so provider dispatch latency stays outside the
  prompt measurement.
- Add opt-in `generation_assembly_persistence` protocol metrics around
  route-owned assembly side-effect persistence for chat-var writes and
  post-`editinput` / input-trigger transcript rewrites.
- Keep existing `generation_persistence` and `generation_persistence_retry`
  metrics as the final-result and retry/finalization measurements.

## Protocol Behavior

- No route shape, SSE frame, provider dispatch, prompt semantics, or persistence
  behavior changes.
- Durable mutation behavior remains unchanged: assembly side effects still use
  the JSON command mutation contract, while final generation messages still use
  the targeted generation persistence path.
- Event behavior remains unchanged: committed projected mutations still bump one
  revision and persist one replayable command event.
- Rollback and resync behavior remain unchanged: failed assembly side-effect
  persistence rolls back through the command transaction and surfaces through the
  existing generation error path; clients reconcile through the existing
  revision/event flow.

## Implemented Result

- `generation_prompt_assembly` includes `status`, `chatId`, `mode`,
  `durationMs`, `promptMs`, `databaseLoadCount`, `databaseLoadMs`, and
  stop/error context when applicable.
- `generation_assembly_persistence` includes `status`, `chatId`, `mode`,
  `revision` for committed writes, `eventType`, chat-var and transcript-write
  flags, and duration.
- Regression coverage asserts the prompt assembly and assembly-persistence
  metrics are emitted separately for a chat-var side-effecting send.

## Done When

- Focused tests prove the new measurement emits without changing the generation
  SSE contract.
- The next runtime optimization is selected only after reviewing metric output
  for a concrete generation/prompt source area.

## Validation

- Passed:
  `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- Passed:
  `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
