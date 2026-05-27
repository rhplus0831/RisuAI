# Fastify-Only Status

## Migration Status

Draft planning is open as of 2026-05-27. No implementation phase has been closed in this folder yet.

The known remaining surfaces are tracked in [plan.md](plan.md), [architecture.md](architecture.md), and the active phase files under [phases](phases/).

## Verification

No runtime verification has been run for this docs-only planning change.

Required closeout commands for implementation work:

- `pnpm check`
- `pnpm test`
- `pnpm api:test`
- `pnpm build`
- `pnpm smoke:fastify-browser`

## Phase Summary

| Phase | Status | Notes |
| --- | --- | --- |
| 0 Audit And Baseline | Not started | Initial surfaces are listed from the 2026-05-27 audit. |
| 1 Project Surface Removal | Not started | Hono, stale scripts, launchers, and native/mobile config remain. |
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
