# Phase 5 Slice: Static Architecture Gate

Status: Complete

## Scope

Move the 29 source-policy assertions embedded in seven broader Happy-DOM
owners into one explicitly labeled Node architecture gate. Keep every mounted,
focus, race, rollback, persistence, and visible-state contract in its existing
DOM owner.

## Change

`frontendArchitecture.static.test.ts` now owns the exceptional source-policy
contracts for responsive partial-edit dialog CSS, picker-token placement,
CharConfig boundaries, lorebook and prompt-template dispatch boundaries,
script-definition routing, and settings ownership. It is registered explicitly
in `vitest.node-tests.ts`.

The original seven D owners no longer import `node:fs` or mix source inspection
into their behavior suites. Their remaining 368 cases continue to run in
Happy-DOM. The service-worker VM execution and recorded fixture reads remain
with their existing owners because they execute behavior or consume test data;
they are not source-policy assertions.

## Focused Evidence

Before the move, the seven D owners passed 7 files / 397 tests in 13.41s Vitest
and 14.27s wall. Worker-phase sums were 45.64s transform, 1.07s setup, 59.00s
import, 1.94s tests, and 1.20s environment; peak RSS was 2,283,868 KiB.

After the move, the same 397 contracts passed as 7 D owners / 368 tests plus
one N architecture gate / 29 tests in 12.99s Vitest and 13.93s wall. Worker
phase sums were 44.91s transform, 1.65s setup, 57.46s import, 1.85s tests, and
1.42s environment; peak RSS was 2,279,492 KiB. The wall and memory changes are
inside run noise; the material result is explicit capability ownership and a
zero-DOM static gate. The Node gate alone completes in 176ms with 0ms
environment setup.

Shuffled test-order runs with seeds 101, 202, and 303 passed with retries
disabled. The combined post-change slice also passed all 397 tests.

## Inventory

Inventory regeneration and checking passed. Full discovery is 536 files at
193 N / 17 S / 326 D, standalone ordinary is 534 at 193 N / 17 S / 324 D, and
aggregate ordinary is 528 at 192 N / 17 S / 319 D. Compared with the preceding
Phase 5 state, this adds one explicit N owner without adding or removing a test.

## Validation

- focused seven-owner pre-change run
- focused Node gate
- combined eight-owner post-change run
- shuffled Node-gate runs with seeds 101, 202, and 303
- `pnpm check:frontend-test-inventory`
- `git diff --check`

All commands passed after removing two empty describe wrappers exposed by the
mechanical transfer.

## Rollback

Revert the gate registration and restore each policy assertion to its original
D owner. No production behavior, runtime configuration, or global isolation
setting changed.
