# Fastify-Only Status

## Migration Status

Phase 0 closed on 2026-05-27 with a green verification baseline. Phase 1 is the current implementation pickup.

The known remaining surfaces are tracked in [plan.md](plan.md), [architecture.md](architecture.md), and the active phase files under [phases](phases/).

## Verification

Latest baseline from Phase 0:

- `pnpm check` passed.
- `pnpm test` passed.
- `pnpm api:test` passed.
- `pnpm build` passed with existing build warnings.
- `pnpm smoke:fastify-browser` passed with existing build warnings.

## Phase Summary

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Audit And Baseline | Completed | Closed on 2026-05-27 in [phases-completed](phases-completed/phase-0-audit-and-baseline-2026-05-27.md). |
| 1 Project Surface Removal | Current pickup | Hono, stale scripts, launchers, and native/mobile config remain. |
| 2 Runtime Contract Collapse | Not started | `__NODE__` and `__FASTIFY__` compatibility bridge remains. |
| 3 Storage Contract Cleanup | Not started | Fastify and legacy storage endpoints still share client code. |
| 4 Proxy And API Routing | Not started | Fastify, legacy node, and hosted proxy paths still coexist. |
| 5 Browser Local Surface Cleanup | Not started | Service worker, preload, and local bootstrap branches still need review. |
| 6 Docs And Packaging Closeout | Not started | README, localized app strings, and packaging docs still contain cross-platform or stale references. |
| 7 Verification Closeout | Not started | Full verification ladder has not run. |

## Closeout Rules

- Do not move a phase to `phases-completed` until the phase file names the changed files, actual verification results, and follow-up items.
- Remove compatibility code instead of leaving dead flags behind.
- Update [status/next-steps.md](status/next-steps.md) after each phase.
- Keep this file present-tense; move historical notes to [phases-completed](phases-completed/).

## References

- [plan.md](plan.md)
- [status/next-steps.md](status/next-steps.md)
- [phases/README.md](phases/README.md)
