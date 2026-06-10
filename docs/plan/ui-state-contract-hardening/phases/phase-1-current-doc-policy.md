# Phase 1: Current Doc Policy

Status: planned.

Goal: make the visible-state test contract part of current testing guidance.

## Scope

- Add a `Visible State Test Contract` section to
  `docs/structure/testing-and-operations.md`.
- Add short pointers from `docs/structure/frontend.md` and
  `docs/structure/server-projection-and-bridges.md`.
- Keep archive docs unchanged except navigation statements that would otherwise
  become false.

## Anchors

- `docs/archive/ui-state-contract-tests.md`
- `docs/structure/testing-and-operations.md`
- `docs/structure/frontend.md`
- `docs/structure/server-projection-and-bridges.md`
- `STRUCTURE.md`
- `docs/archive/README.md`

## Target Shape

Current docs should state:

- If a code change affects state the user can see, validation must assert the
  visible result after the same transition.
- State/helper assertions, command payload assertions, and fetch mocks do not by
  themselves prove UI correctness.
- Optimistic paths must prove immediate visible change and visible rollback.
- Use the smallest ring that proves the contract:
  state/helper Vitest, Svelte DOM Vitest, then Fastify browser smoke.
- Require a state-to-DOM test for changes touching `DBState`, `selectedCharID`,
  `chatPage`, `loadedStore`, projection guard writes, bootstrap/resync/SSE,
  optimistic command helpers, bridge watchers, router selection, array
  create/delete/reorder flows, `$derived`, `$effect`, keyed lists, memo
  signatures, or render dependency keys.

## Invariants

- Do not turn this into a new gate.
- Do not mark archived UI-state pilot work as active.
- Keep the policy short enough to be read during ordinary feature work.

## Done Criteria

- Current docs include the visible-state contract and test rings.
- Phase status and latest verification are updated.
- Docs-only validation passes.

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
