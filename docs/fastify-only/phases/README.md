# Fastify-Only Phases

Active phase plans live here until they are completed. Completed phase notes move to [../phases-completed](../phases-completed/).

## Phase Index

1. [Phase 7: Verification Closeout](phase-7-verification-closeout.md)

Completed phase notes live in [../phases-completed](../phases-completed/), including [Phase 0: Audit And Baseline](../phases-completed/phase-0-audit-and-baseline-2026-05-27.md), [Phase 1: Project Surface Removal](../phases-completed/phase-1-project-surface-removal-2026-05-27.md), [Phase 2: Runtime Contract Collapse](../phases-completed/phase-2-runtime-contract-collapse-2026-05-27.md), [Phase 3: Storage Contract Cleanup](../phases-completed/phase-3-storage-contract-cleanup-2026-05-27.md), [Phase 4: Proxy And API Routing](../phases-completed/phase-4-proxy-and-api-routing-2026-05-27.md), [Phase 5: Browser Local Surface Cleanup](../phases-completed/phase-5-browser-local-surface-cleanup-2026-05-27.md), and [Phase 6: Docs And Packaging Closeout](../phases-completed/phase-6-docs-and-packaging-closeout-2026-05-27.md).

## Dependency Order

- Phase 0 is complete; the baseline is recorded before code removal.
- Phase 1 is complete; project-level Hono, launcher, and native/mobile surfaces are removed.
- Phase 2 is complete; storage, proxy, and browser-local cleanup can proceed on the single Fastify signal.
- Phase 3 is complete; storage and bootstrap app persistence now use the Fastify contract only.
- Phase 4 is complete; client proxy calls select Fastify `/api/v1/proxy/*` endpoints only.
- Phase 5 is complete; browser-local service worker, preload, standalone persistence, and backup/restore runtime paths are removed.
- Phase 6 is complete; README, localized runtime strings, Docker access docs, development instructions, and smoke instructions are Fastify-only.
- Phase 7 closes the verification trail.

## Closeout

Each completed phase should record changed files, verification results, and follow-up work before moving to [../phases-completed](../phases-completed/).
