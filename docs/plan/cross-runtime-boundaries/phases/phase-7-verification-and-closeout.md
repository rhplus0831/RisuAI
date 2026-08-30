# Phase 7: Verification And Closeout

Status: queued.

Depends on: Phases 0-6 complete.

## Objective

Prove the final dependency direction, synchronize current documentation, record
exceptions, and prepare the intact workstream for archival.

## Required Work

- Run protocol/shared import audits, route/operation parity, clean-worktree
  typechecks, focused parity tests, complete owning lanes, browser smoke, and
  build/configuration gates.
- Re-run the import inventory and prove zero unapproved production edge.
- Record each retained test/smoke exception with owner and review/removal trigger.
- Update architecture, testing, generated-path, provider/prompt/resource, and
  domain-ownership docs that changed.
- Refresh `latest-verification.md` at the exact final candidate.

## Exit Criteria

- Every closeout criterion in `PLAN.md` is tied to exact evidence.
- No current guide describes the retired declaration or import architecture.
- Workstream 2/3 dependency releases are recorded by contract/resource family.
- The final full verification passes and the workstream can move intact to
  `.archived-docs/architecture-and-migration/`.

## Validation

User/CI-owned evidence from the shared verification ladder, including
`pnpm test:all`, browser smoke, both typecheck families, Prettier, and
`git diff --check`, with exact counts and caveats recorded.
