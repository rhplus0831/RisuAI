# Fastify-Only Status

## Migration Status

Phase 0 closed on 2026-05-27 with a green verification baseline. Phase 1 closed on 2026-05-27. Phase 2 closed on 2026-05-27. Phase 3 closed on 2026-05-27 after removing legacy storage routes, local app persistence selection, and bootstrap local save-file fallback. Phase 4 closed on 2026-05-27 after removing hosted and legacy proxy route selection. Phase 5 closed on 2026-05-27 after removing service-worker share/cache paths, PWA share/file handlers, preload markers, standalone persistence, and local backup/restore affordances. Phase 6 closed on 2026-05-27 after aligning README, localized runtime strings, Docker access docs, development instructions, and smoke instructions with the Fastify-only runtime.

The remaining closeout work is tracked in [Phase 7: Verification Closeout](phases/phase-7-verification-closeout.md).

## Verification

Latest full verification from Phase 5:

- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 76 files, 772 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

Latest Phase 6 verification:

- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings: 1 Playwright test.

## Phase Summary

| Phase                           | Status         | Notes                                                                                                                                        |
| ------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Audit And Baseline            | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-0-audit-and-baseline-2026-05-27.md).                                       |
| 1 Project Surface Removal       | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-1-project-surface-removal-2026-05-27.md).                                  |
| 2 Runtime Contract Collapse     | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-2-runtime-contract-collapse-2026-05-27.md).                                |
| 3 Storage Contract Cleanup      | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-3-storage-contract-cleanup-2026-05-27.md).                                 |
| 4 Proxy And API Routing         | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-4-proxy-and-api-routing-2026-05-27.md).                                    |
| 5 Browser Local Surface Cleanup | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-5-browser-local-surface-cleanup-2026-05-27.md).                          |
| 6 Docs And Packaging Closeout   | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-6-docs-and-packaging-closeout-2026-05-27.md).                             |
| 7 Verification Closeout         | Current pickup | Full verification ladder has not run after Phase 6.                                                                                          |

## Closeout Rules

- Do not move a phase to `phases-completed` until the phase file names the changed files, actual verification results, and follow-up items.
- Remove compatibility code instead of leaving dead flags behind.
- Update [status/next-steps.md](status/next-steps.md) after each phase.
- Keep this file present-tense; move historical notes to [phases-completed](phases-completed/).

## References

- [plan.md](plan.md)
- [status/next-steps.md](status/next-steps.md)
- [phases/README.md](phases/README.md)
