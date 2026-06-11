# Slice: Current Testing Policy

Phase: [1](../../phase-1-current-doc-policy.md). No runtime change.

Status: complete.

## Scope

Add a concise `Visible State Test Contract` section to
`docs/structure/testing-and-operations.md`.

This slice does not edit frontend/projection structure docs except through the
separate pointer slice.

## Visible Contract

Current testing guidance must say that when a change affects state the user can
see, validation must assert the rendered result after the same transition.

## Anchors

- `docs/archive/ui-state-contract-tests.md`
- `docs/structure/testing-and-operations.md`
- `docs/plan/ui-state-contract-hardening/audit.md`

## Target Shape

- Explain that helper/state assertions, command payload assertions, and fetch
  mocks are not enough when the bug class is stale visible UI.
- Require visible optimistic change and visible rollback where rollback is part
  of behavior.
- Define the test rings: helper Vitest, Svelte DOM Vitest, and sparse Fastify
  browser smoke.
- List trigger surfaces that should prompt a state-to-DOM test:
  `DBState`, `selectedCharID`, `chatPage`, `loadedStore`, projection writes,
  bootstrap/resync/SSE, optimistic command helpers, bridge watchers, router
  selection, array create/delete/reorder flows, `$derived`, `$effect`, keyed
  lists, memo signatures, and render dependency keys.
- State that this is policy guidance, not a new gate.

## Invariants

- Keep the section short enough for ordinary feature work.
- Do not mark archived pilot work as active.
- Do not introduce a new completeness gate.

## Done Criteria

- [x] `docs/structure/testing-and-operations.md` contains the visible-state
      contract and test-ring guidance.
- [x] The section uses current Fastify-only structure terms.

## Validation

```bash
pnpm exec prettier --check docs/structure/testing-and-operations.md
git diff --check
```
