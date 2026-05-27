# Fastify-Only Phases

Active phase plans live here until they are completed. Completed phase notes move to [../phases-completed](../phases-completed/).

## Phase Index

1. [Phase 0: Audit And Baseline](phase-0-audit-and-baseline.md)
2. [Phase 1: Project Surface Removal](phase-1-project-surface-removal.md)
3. [Phase 2: Runtime Contract Collapse](phase-2-runtime-contract-collapse.md)
4. [Phase 3: Storage Contract Cleanup](phase-3-storage-contract-cleanup.md)
5. [Phase 4: Proxy And API Routing](phase-4-proxy-and-api-routing.md)
6. [Phase 5: Browser Local Surface Cleanup](phase-5-browser-local-surface-cleanup.md)
7. [Phase 6: Docs And Packaging Closeout](phase-6-docs-and-packaging-closeout.md)
8. [Phase 7: Verification Closeout](phase-7-verification-closeout.md)

## Dependency Order

- Phase 0 should happen before code removal so the baseline is recorded.
- Phase 1 can remove clearly stale project surfaces before runtime code changes.
- Phase 2 should land before storage, proxy, and bootstrap cleanup.
- Phase 3 and Phase 4 may be split into smaller slices if tests need to land first.
- Phase 5 should follow the runtime and storage decisions so browser-local code is removed with context.
- Phase 6 and Phase 7 close the user-facing docs and verification trail.

## Closeout

Each completed phase should record changed files, verification results, and follow-up work before moving to [../phases-completed](../phases-completed/).
