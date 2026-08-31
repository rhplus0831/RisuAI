# Phase 7: Verification And Closeout

Status: complete at `993222d82` with current-guide reconciliation at
`27c41103d`.

Depends on: Phases 0-6 complete and all Workstream 3 releases/holds resolved.

## Objective

Prove canonical ownership, compatibility boundaries, migration safety, current
documentation, and archival readiness at one exact candidate.

## Required Work

- Re-run the compatibility inventory and prove every surface has a final owner
  and disposition.
- Run migration, interruption, rollback, reopen, lineage, fixture, backup/
  restore, import/export, provider, prompt, translation, command, and browser
  gates.
- Record retained compatibility surfaces and exact input/output/recovery
  boundaries.
- Update current data/events, providers/models, prompt, translation, assets/
  saves, generated/legacy, testing, and client-resource docs.
- Refresh `latest-verification.md` with exact commits, environment, counts,
  caveats, and verdict.

## Exit Criteria

- Every closeout criterion in `PLAN.md` has exact evidence.
- Workstream 3 has a final per-resource release or permanent-compatibility hold.
- No current guide describes a retired mirror/fallback as normal authority.
- Full final verification passes and the intact workstream can move to
  `.archived-docs/architecture-and-migration/`.

## Validation

User/CI-owned portfolio closeout evidence, including compatibility differentials
where required, complete owning lanes, browser smoke, both typechecks,
`pnpm test:all`, Prettier, and `git diff --check`.
