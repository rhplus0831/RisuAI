# Neutral Cross-Runtime Test Fixtures

Status: complete at `e75d742b6`.

Parent: [Phase 4](../../phase-4-server-consumer-migration.md)

Depends on: the Phase 0 neutral test-fixture convention.

## Objective

Move dependency-free fixtures shared by browser, Fastify, browser-smoke, and the
compatibility harness out of the browser application tree.

## Boundary

- Deterministic large corpus used by cost and recovery probes.
- Phase 9 state-independent CBS compatibility corpus.
- Phase 9 baseline-drift fixtures.
- Delivered delta: five server-test and two browser-smoke runtime root-`src`
  edges; 210 total edges became 203.

## Behavior Contract

Preserve deterministic corpus sizing, hot/no-Hypa chat distinctions, populated
collections and vectors, CBS grammar expectations, drift inputs, and every
consumer import. No production code changed.

## Verification

Command narrowing, budgets, load cost, server prompt variables, browser CBS
strings, and browser drift suites passed 21, 2, 38, 33, 19, and 5 tests. The
pinned compatibility-harness target was refused by the focused-test guard. Both
typechecks, the 203-edge architecture inventory, formatting, and diff checks
passed.
