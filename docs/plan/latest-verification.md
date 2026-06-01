# Latest Verification

Date: 2026-06-02

This file records the latest maintained verification result for the
server/client protocol stability and performance workstream. Replace this
section on the next full or focused verification run; do not append historical
runs here.

## Latest Run

- Runtime/code commit under test: this full-bootstrap resync budget slice.
- Scope: Phase 3 full-bootstrap resync reason diagnostics and bootstrap
  fallback-path regression coverage.
- Result: passed.

| Command                                 | Result                                                                |
| --------------------------------------- | --------------------------------------------------------------------- |
| `pnpm test -- src/ts/bootstrap.test.ts` | Passed: configured client Vitest run, 99 files, 940 tests, 4 skipped. |

## Notes

- The client Vitest command ran the configured client suite, not only the named
  bootstrap file.
- Full-bootstrap resync diagnostics now distinguish expected reasons from
  unexpected reason strings.
- Bootstrap tests cover the expected fallback reasons:
  `event-replay-unavailable`, `no-baseline`, `projection-error`,
  `projection-full-mode`, and `revision-gap`.
