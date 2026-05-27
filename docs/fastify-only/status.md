# Fastify-Only Status

## Migration Status

Phase 0 closed on 2026-05-27 with a green verification baseline. Phase 1 closed on 2026-05-27. Phase 2 closed on 2026-05-27. Phase 3 closed on 2026-05-27 after removing legacy storage routes, local app persistence selection, and bootstrap local save-file fallback. Phase 4 closed on 2026-05-27 after removing hosted and legacy proxy route selection. Phase 5 is the current implementation pickup; Phase 5A closed on 2026-05-27 after removing service-worker share/cache paths, PWA share/file handlers, and the preload marker.

The known remaining surfaces are tracked in [plan.md](plan.md), [architecture.md](architecture.md), and the active phase files under [phases](phases/).

## Verification

Latest full verification from Phase 5A:

- `pnpm check` passed with 0 errors and 0 warnings.
- `pnpm test` passed: 76 files, 772 tests passed, and 4 tests skipped.
- `pnpm api:test` passed: 68 files and 1217 tests.
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
| 5 Browser Local Surface Cleanup | Current pickup | Phase 5A removed service-worker/preload/share surfaces; remaining pickup should audit UI copy/gates and any other browser-local affordances. |
| 6 Docs And Packaging Closeout   | Not started    | README, localized app strings, and packaging docs still contain cross-platform or stale references.                                          |
| 7 Verification Closeout         | Not started    | Full verification ladder has not run.                                                                                                        |

## Closeout Rules

- Do not move a phase to `phases-completed` until the phase file names the changed files, actual verification results, and follow-up items.
- Remove compatibility code instead of leaving dead flags behind.
- Update [status/next-steps.md](status/next-steps.md) after each phase.
- Keep this file present-tense; move historical notes to [phases-completed](phases-completed/).

## References

- [plan.md](plan.md)
- [status/next-steps.md](status/next-steps.md)
- [phases/README.md](phases/README.md)
