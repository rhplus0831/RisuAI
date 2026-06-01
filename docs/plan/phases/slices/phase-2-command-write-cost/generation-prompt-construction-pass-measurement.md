# Generation Prompt Construction Pass Measurement

Status: candidate; analysis only, not implemented.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/prompt/assemble.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/src/protocolMetrics.ts`
- `server/fastify/__tests__/generation.chat.test.ts`

## Why This Exists

Phase 2 narrowed generation persistence and assembly-time side-effect writes,
but prompt assembly itself still starts by loading a hydrated persisted database
with `loadPersistedWithMessages()`. That is correct today because the assembler
can inspect global settings, presets/loadouts, active modules, lorebooks,
characters, chat metadata, messages, memory settings, triggers, and assets
during one prompt build.

The next runtime change should not guess which subset is safe. First measure the
major prompt assembly stages so the next candidate can name the source area it
will narrow.

## Candidate Scope

Measurement-only first pass:

- Extend opt-in `generation_prompt_assembly` metrics with coarse phase timings:
  persisted database load/hydration, scope resolution, static/plain slots,
  lorebook activation, history/bias, memory bridge, final render, and budget.
- Keep provider dispatch, SSE frames, prompt rows, route bodies, and persistence
  behavior unchanged.
- Report enough scenario context to compare plain send, preview prompt, durable
  generation, lorebook-heavy sends, and asset/memory-enabled sends.
- Use the metric review to decide whether a later implementation slice should
  target a narrower prompt-state loader, a cached read model, or no runtime
  change.

## Protocol Behavior

- No route, event, revision, SSE, provider payload, or storage contract changes
  are allowed in the measurement pass.
- Assembly side effects must keep the existing targeted assembly path.
- Final generation persistence must keep the existing targeted generation path.

## Rollback And Resync Behavior

No rollback behavior changes are expected for measurement. If a later runtime
slice changes state loading, it must preserve stale-revision behavior,
generation error frames, and command-event reconciliation.

## Done When

- Focused metrics identify whether the remaining cost is dominated by database
  hydration, lorebook/history construction, memory, render/budget, or another
  named stage.
- The next implementation slice, if any, names one durable read or construction
  area and its proof command.
- The measurement stays opt-in and cheap when protocol metrics are disabled.

## Proof Commands

- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- `RISU_PROTOCOL_METRICS=1 RISU_GENERATION_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts --reporter verbose`
