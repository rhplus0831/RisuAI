# Fastify-Only Status

## Migration Status

Phase 0 closed on 2026-05-27 with a green verification baseline. Phase 1 closed on 2026-05-27. Phase 2 closed on 2026-05-27. Phase 3 is the current implementation pickup. Phase 3A removed the legacy client storage route table on 2026-05-27. Phase 3B removed OPFS/localforage app-runtime persistence selection on 2026-05-27.

The known remaining surfaces are tracked in [plan.md](plan.md), [architecture.md](architecture.md), and the active phase files under [phases](phases/).

## Verification

Latest full verification from Phase 3B:

- `pnpm check` passed.
- `pnpm test` passed.
- `pnpm api:test` passed.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings.

## Phase Summary

| Phase                           | Status         | Notes                                                                                                         |
| ------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- |
| 0 Audit And Baseline            | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-0-audit-and-baseline-2026-05-27.md).        |
| 1 Project Surface Removal       | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-1-project-surface-removal-2026-05-27.md).   |
| 2 Runtime Contract Collapse     | Completed      | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-2-runtime-contract-collapse-2026-05-27.md). |
| 3 Storage Contract Cleanup      | Current pickup | Client storage routes and app persistence selection are Fastify-only; bootstrap fallback cleanup remains.     |
| 4 Proxy And API Routing         | Not started    | Fastify, legacy node, and hosted proxy paths still coexist.                                                   |
| 5 Browser Local Surface Cleanup | Not started    | Service worker, preload, and local bootstrap branches still need review.                                      |
| 6 Docs And Packaging Closeout   | Not started    | README, localized app strings, and packaging docs still contain cross-platform or stale references.           |
| 7 Verification Closeout         | Not started    | Full verification ladder has not run.                                                                         |

## Closeout Rules

- Do not move a phase to `phases-completed` until the phase file names the changed files, actual verification results, and follow-up items.
- Remove compatibility code instead of leaving dead flags behind.
- Update [status/next-steps.md](status/next-steps.md) after each phase.
- Keep this file present-tense; move historical notes to [phases-completed](phases-completed/).

## References

- [plan.md](plan.md)
- [status/next-steps.md](status/next-steps.md)
- [phases/README.md](phases/README.md)
