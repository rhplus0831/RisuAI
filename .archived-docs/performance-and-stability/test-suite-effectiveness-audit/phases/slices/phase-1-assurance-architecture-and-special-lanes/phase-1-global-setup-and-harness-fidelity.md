# P01-S02: Global Setup And Harness Fidelity

Date: 2026-08-29

Status: Complete.

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
- `TSA-P01-011` / `TSA-P01-012`: make row-identity and table-budget oracles fail
  closed when evidence is missing or an unrelated row appears/disappears.
- `TSA-P01-013`: inventory the omitted memory-embedding deadline/budget seam.
- `TSA-P01-014`: replace server-backed send scheduling guesses with the
  observable production drain.
- `TSA-P01-015`: replace current-codec-generated legacy saves with frozen
  pre-migration vectors.
- `TSA-P01-016`: remove only the harness exports proven consumerless.
- `vitest.setup.test.ts`: Keep all four cases as the direct shared-setup oracle.
- No production file or existing product test was removed.

## Evidence

- Focused setup/parser verification passed 14/14.
- Complete frontend verification passed 6,651/6,651 across 536 files.
- Focused server helper/consumer verification passed, including the combined
  8-case mutation oracle, 21 single-row cases, 81 dependent range cases, and 39
  save-codec/bounded-inflate cases.
- Live tracked total is 9,991 cases across 699 files.

## Residual Boundary

- `TSA-P01-017` retains one explicit resource-database migration adapter. Its
  assertions are classified as composed-resource evidence, never bootstrap wire
  evidence; owning Phases 3/6/11 migrate consumers and Phase 13 removes it.
- Browser smoke is retained with the exact evidence exclusions in
  `TSA-P01-018` and the authoritative testing documentation.
- The first aggregate attempt intentionally remained red because the changed
  send fixture made the checked routing TSV stale. All other nine lanes passed;
  the manifest was refreshed and the complete aggregate was rerun for closeout.
