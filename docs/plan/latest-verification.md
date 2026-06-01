# Latest Verification

Date: 2026-06-01

This file records the latest maintained verification result for the
server/client protocol stability and performance workstream. Replace this
section on the next full or focused verification run; do not append historical
runs here.

## Latest Run

- Runtime/code commit under test: this generation prompt metric review slice.
- Scope: Phase 2 generation/prompt metric review, selected assembly
  side-effect narrow-path candidate, existing command metric review gates, and
  client-thinning architecture audit.
- Result: passed.

| Command                                                                                                                                        | Result                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts` | Passed: server API suite, 83 files, 1479 tests, 1 skipped.          |
| `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`                                              | Passed: 1 file, 1 test; command metric review-gate summary emitted. |
| `pnpm client-thinning:audit`                                                                                                                   | Passed: client-thinning audit passed.                               |

## Notes

- The server Vitest generation command ran the configured server API suite, not
  only the named files.
- Generation/prompt measurement is opt-in through `RISU_PROTOCOL_METRICS`; the
  runtime protocol behavior and SSE frame contract are unchanged.
- The focused metric review proves assembly-time chat-var and transcript
  rewrite side effects still report `mutationPath: "hydrated"`; durable final
  generation persistence remains `targeted-generation` with `dbJsonWriteMs: 0`.
- Command metric timings are review readouts; the maintained hard checks are
  metric shape, known review gates, retained mutation paths, and
  `dbJsonWriteMs: 0` on targeted paths.
