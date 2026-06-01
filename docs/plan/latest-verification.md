# Latest Verification

Date: 2026-06-01

This file records the latest maintained verification result for the
server/client protocol stability and performance workstream. Replace this
section on the next full or focused verification run; do not append historical
runs here.

## Latest Run

- Runtime/code commit under test: `10d1ffc2` (later commits through
  `35441587` are documentation-only plan updates)
- Scope: Phase 8 verification budgets after payload-size, request-count, and
  command metric review-gate slices.
- Result: passed.

| Command                                                                                           | Result                                                              |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm test -- src/ts/server/chatMessageHydration.test.ts`                                         | Passed: 99 files, 938 tests, 4 skipped.                             |
| `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose` | Passed: 1 file, 1 test; command metric review-gate summary emitted. |
| `pnpm client-thinning:audit`                                                                      | Passed: client-thinning audit passed.                               |

## Notes

- The client Vitest command ran the configured client test set, not only the
  named file.
- Command metric timings are review readouts; the maintained hard checks are
  metric shape, known review gates, retained mutation paths, and
  `dbJsonWriteMs: 0` on targeted paths.
