# Fastify-Only Phases

Active phase plans live here until they are completed. Completed phase notes move to [../phases-completed](../phases-completed/).

## Phase Index

1. [Phase 2: Runtime Contract Collapse](phase-2-runtime-contract-collapse.md)
2. [Phase 3: Storage Contract Cleanup](phase-3-storage-contract-cleanup.md)
3. [Phase 4: Proxy And API Routing](phase-4-proxy-and-api-routing.md)
4. [Phase 5: Browser Local Surface Cleanup](phase-5-browser-local-surface-cleanup.md)
5. [Phase 6: Docs And Packaging Closeout](phase-6-docs-and-packaging-closeout.md)
6. [Phase 7: Verification Closeout](phase-7-verification-closeout.md)

Completed phase notes live in [../phases-completed](../phases-completed/), including [Phase 0: Audit And Baseline](../phases-completed/phase-0-audit-and-baseline-2026-05-27.md) and [Phase 1: Project Surface Removal](../phases-completed/phase-1-project-surface-removal-2026-05-27.md).

## Dependency Order

- Phase 0 is complete; the baseline is recorded before code removal.
- Phase 1 is complete; project-level Hono, launcher, and native/mobile surfaces are removed.
- Phase 2 should land before storage, proxy, and browser-local cleanup.
- Phase 3 and Phase 4 may be split into smaller slices if tests need to land first.
- Phase 5 should follow the runtime and storage decisions so browser-local code is removed with context.
- Phase 6 and Phase 7 close the user-facing docs and verification trail.

## Closeout

Each completed phase should record changed files, verification results, and follow-up work before moving to [../phases-completed](../phases-completed/).
