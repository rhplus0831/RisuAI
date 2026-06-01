# Generation Prompt Construction Pass Measurement

Status: implemented measurement; no runtime narrowing yet.

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

## Implemented Scope

The measurement pass extends the existing opt-in `generation_prompt_assembly`
metric with `stageTimingsMs`. The current stage keys are:

- `scope_resolution`
- `submit_transforms`
- `static_plain_slots`
- `lorebook_preflight`
- `history_bias`
- `memory_bridge`
- `final_render`
- `budget`

The existing `databaseLoadCount` and `databaseLoadMs` fields continue to report
the hydrated persisted database load through `loadPersistedWithMessages()`.
Stage timings are recorded through an optional assembler dependency callback, so
the assembler stays storage-global-free and the extra timing work is only wired
when `RISU_PROTOCOL_METRICS` is enabled.

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
  named stage. The 2026-06-02 focused fixture run found plain, preview, and
  durable sends at roughly 2ms with database load around 0.34-0.38ms. The
  largest fixture costs were Lua/input-transform scenarios, where
  `submit_transforms` and `final_render` dominated.
- The next implementation slice, if any, must name one durable read or
  construction area and its proof command. No runtime narrowing is justified
  from the focused fixture run alone; use the metric on lorebook-heavy,
  asset-heavy, memory-enabled, or real user corpora before changing load shape.
- The measurement stays opt-in and cheap when protocol metrics are disabled.

## Proof Commands

- `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- `RISU_PROTOCOL_METRICS=1 RISU_GENERATION_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts --reporter verbose`
