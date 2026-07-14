# Slice: Archive Closeout

Phase: [6](../../phase-6-verification-closeout.md). Documentation/archive
change.

Status: complete. Depends on
[`final-validation-matrix.md`](final-validation-matrix.md).

## Scope

Move the completed workstream from `docs/plan/` to `.archived-docs/` and update
navigation after closeout proof is green.

This is the only planned archive edit beyond navigation notes.

## Anchors

- `.archived-docs/ui-and-user-input/visible-state/state-contract-hardening/`
- `.archived-docs/README.md`
- `STRUCTURE.md`
- `.archived-docs/ui-and-user-input/visible-state/state-contract-hardening/latest-verification.md`
- `.archived-docs/ui-and-user-input/visible-state/state-contract-hardening/status.md`

## Target Shape

- Workstream files move under `.archived-docs/ui-and-user-input/visible-state/state-contract-hardening/`.
- Archive README gains a row or pointer for the closed workstream.
- `STRUCTURE.md` and any current active-plan navigation no longer imply this
  workstream is active.
- Final status/latest-verification entries record archive date and closeout
  proof.

## Invariants

- Do not archive while required validation is failing.
- Do not reopen archived v1/v2/v3 gates.
- Preserve proof logs; do not rewrite history to hide caveats.

## Done Criteria

- Active plan folder is no longer listed as open work.
- Archive navigation points to the closed plan.
- `git diff --check` passes after the move.

## Validation

```bash
pnpm exec prettier --check STRUCTURE.md .archived-docs/README.md '.archived-docs/ui-and-user-input/visible-state/state-contract-hardening/**/*.md'
git diff --check
```
