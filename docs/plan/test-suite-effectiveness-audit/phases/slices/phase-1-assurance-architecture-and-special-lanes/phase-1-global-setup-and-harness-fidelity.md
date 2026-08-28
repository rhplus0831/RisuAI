# P01-S02: Global Setup And Harness Fidelity

Date: 2026-08-29

Status: In progress.

## Exact Scope

- `vitest.setup.ts`, `vitest.dom.setup.ts`, the custom Svelte environment, and
  their direct oracle files;
- shared frontend/server test helpers, fixtures, support manifests, and
  architecture-policy owners whose harness behavior can create false confidence.

## Completed Decisions

- `TSA-P01-009`: remove the global empty KaTeX mock and exercise successful
  formula rendering through the real behavior owner.
- `TSA-P01-010`: make the all-ready startup baseline complete and pin its exact
  public capability vector.
- `vitest.setup.test.ts`: Keep all four cases as the direct shared-setup oracle.
- No production file or existing product test was removed.

## Evidence

- Focused setup/parser verification passed 14/14.
- Complete frontend verification passed 6,651/6,651 across 536 files.
- Live tracked total is 9,987 cases across 699 files.

## Remaining Exit Work

- resolve shared-server oracle gaps and support-manifest omissions;
- record adapter and browser-smoke evidence bounds;
- remove only exports proven orphaned across every consumer surface;
- pass focused owners plus the complete aggregate before closing the slice.
