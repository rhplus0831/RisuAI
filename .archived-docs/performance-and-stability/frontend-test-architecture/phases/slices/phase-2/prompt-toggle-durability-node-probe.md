# Phase 2 Slice: Prompt-Toggle Durability Node Probe

Status: Complete without promotion

## Scope

Evaluate `src/lib/Setting/Pages/BotSettings.promptToggleDurable.test.ts` for
promotion from Happy-DOM to Node, then retain its current owner after proving
that the durable mutation graph requires Svelte rune transformation.

No production module, test body, mock, assertion, or permanent runtime
inventory changes in this proof batch.

## Capability And Behavior Boundaries

- The two tests prove ordered staging under a shared prompt owner and failed
  predecessor recovery before a later toggle can settle.
- The suite supplies `fake-indexeddb`, replaces the authenticated command
  boundary, and performs no component mount, DOM operation, browser-storage
  convenience access, or real network request.
- The real pending-mutation outbox imports
  `server/persistenceActivity.svelte.ts`, which initializes `$state` during
  module evaluation.
- Mocking that activity boundary solely to pass Node would remove a production
  dependency from the durable staging and replay behavior under test.

## Probe Result

The current Happy-DOM owner passed 1 file / 2 tests in 1.44s wall and 696ms
Vitest duration, with 318,004 KiB peak RSS and 102ms aggregate environment
time.

The temporary `frontend-node` probe failed before collection with
`ReferenceError: $state is not defined` at
`src/ts/server/persistenceActivity.svelte.ts:3`. It took 0.85s wall and 219ms
Vitest duration, with 268,192 KiB peak RSS and no environment time.

The temporary `frontend-svelte-node` classification probe passed 1 file / 2
tests in 1.11s wall and 545ms Vitest duration, with 288,136 KiB peak RSS and
16ms aggregate environment time. S is therefore the smallest current runtime
that executes the unchanged suite.

Both temporary inventory entries were removed. No migration or paired ordinary
performance claim landed.

## Validation And Deferral

- Current-owner and Svelte+Node runs passed all two tests; the exact Node probe
  failed for the recorded rune reason.
- `pnpm check:frontend-test-inventory` retained the exhaustive and disjoint
  537-file full, 535-file standalone ordinary, and 529-file aggregate ordinary
  universes.
- Formatting of changed files and `git diff --check` passed.

Owner: Phase 3 UI-settings S promotion. Reason: the unchanged durable outbox
graph requires Svelte rune transformation without DOM behavior. Revisit when
Phase 3 begins, or earlier only if the production graph removes the rune edge
and a fresh Node probe passes.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

No runtime rollback is required. Replace this proof only with fresher target
runtime evidence after a relevant import-graph change.
