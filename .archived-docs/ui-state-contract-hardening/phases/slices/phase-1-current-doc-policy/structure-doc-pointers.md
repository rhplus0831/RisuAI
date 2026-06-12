# Slice: Structure Doc Pointers

Phase: [1](../../phase-1-current-doc-policy.md). No runtime change.

Status: complete. Depends on
[`current-testing-policy.md`](current-testing-policy.md).

## Scope

Add short references from current frontend and projection docs back to the
visible-state testing policy.

This slice does not duplicate the full policy text.

## Visible Contract

Agents reading frontend or projection docs should be routed to the current
visible-state policy before changing state-to-render behavior.

## Anchors

- `docs/structure/frontend.md`
- `docs/structure/server-projection-and-bridges.md`
- `docs/structure/testing-and-operations.md`

## Target Shape

- `frontend.md` points to the visible-state contract near startup/projection or
  component testing guidance.
- `server-projection-and-bridges.md` points to the policy near projection guard,
  hydration, bridge watchers, or event reconcile guidance.
- Both pointers stay brief and defer details to
  `testing-and-operations.md`.

## Invariants

- Do not add archive links as if archived docs are current policy.
- Do not make these docs longer than necessary.

## Done Criteria

- [x] Both current structure docs include a pointer to the policy.
- [x] The pointers do not conflict with the Fastify-only architecture map.

## Validation

```bash
pnpm exec prettier --check \
  docs/structure/frontend.md \
  docs/structure/server-projection-and-bridges.md
git diff --check
```
