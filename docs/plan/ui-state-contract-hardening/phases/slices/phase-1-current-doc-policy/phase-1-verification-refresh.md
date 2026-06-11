# Slice: Phase 1 Verification Refresh

Phase: [1](../../phase-1-current-doc-policy.md). No runtime change.

Status: planned. Depends on
[`current-testing-policy.md`](current-testing-policy.md) and
[`structure-doc-pointers.md`](structure-doc-pointers.md).

## Scope

Refresh Phase 1 proof and plan navigation after the current-doc policy lands.

This slice does not change runtime code.

## Anchors

- `docs/plan/ui-state-contract-hardening/status.md`
- `docs/plan/ui-state-contract-hardening/latest-verification.md`
- `docs/structure/testing-and-operations.md`
- `docs/structure/frontend.md`
- `docs/structure/server-projection-and-bridges.md`

## Target Shape

- Phase 1 status moves to complete only after docs validation passes.
- `latest-verification.md` records exact commands, dates, and results.
- `status.md` points the next implementation cursor at Phase 2.

## Invariants

- Record only commands that actually ran.
- Do not treat Phase 1 docs proof as proof for later runtime phases.

## Done Criteria

- Phase 1 docs are formatted.
- `status.md` and `latest-verification.md` are updated.

## Validation

```bash
pnpm exec prettier --check \
  STRUCTURE.md \
  docs/archive/README.md \
  docs/structure/testing-and-operations.md \
  docs/structure/frontend.md \
  docs/structure/server-projection-and-bridges.md \
  'docs/plan/**/*.md'
git diff --check
```
