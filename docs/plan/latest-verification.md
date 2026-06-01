# Latest Verification

Date: 2026-06-02

This file records the latest maintained verification result for the
server/client protocol stability and performance workstream. Replace this
section on the next full or focused verification run; do not append historical
runs here.

## Latest Run

- Runtime/code commit under test: Phase 2 prompt-construction stage measurement
  slice.
- Scope: opt-in `generation_prompt_assembly` database-load and construction
  stage timings, generation metric family review, durable generation coverage,
  and no protocol/persistence behavior changes.
- Result: passed.

| Command                                                                                                                                                                                      | Result                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`                                               | Passed: configured server API suite, 83 files, 1481 tests, 1 skipped. |
| `RISU_PROTOCOL_METRICS=1 RISU_GENERATION_METRIC_SUMMARY=1 pnpm exec vitest run --config server/fastify/vitest.config.ts server/fastify/__tests__/generation.chat.test.ts --reporter verbose` | Passed: focused generation chat suite, 1 file, 58 tests.              |

## Notes

- The first server API command ran the configured suite, not only the named
  files.
- `generation_prompt_assembly` now reports `stageTimingsMs` for
  `scope_resolution`, `submit_transforms`, `static_plain_slots`,
  `lorebook_preflight`, `history_bias`, `memory_bridge`, `final_render`, and
  `budget`.
- Focused fixture summaries showed plain, preview, and durable sends around
  2ms, with database load around 0.34-0.38ms. Lua/input-transform fixtures were
  dominated by `submit_transforms` and `final_render`; no runtime narrowing is
  justified from the focused fixtures alone.
