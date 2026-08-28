# Phase 4 Slice: Router Route Planning

Status: Complete

## Scope

Move the router's deterministic parsing, canonical path construction,
state-to-path precedence, normalization, and route-identity matrix to Node.
Retain browser history, `window.location`, Svelte stores, resource application,
navigation guards, and asynchronous freshness behavior in Happy-DOM.

The production boundary already existed as the plain TypeScript
`routerRoute.ts` leaf. This slice makes that architecture explicit in test
ownership rather than adding another production abstraction.

## Source And Capability Boundaries

- N owner: `src/ts/routerRoute.test.ts` imports only the production route leaf
  and Vitest. Eight tests cover settings and playground aliases, numeric and
  fallback handling, retired paths, malformed encoding, canonical and legacy
  character routes, path helper encoding, state precedence, normalization, and
  route keys.
- Production caller: `src/ts/router.ts` continues to consume the leaf for
  initial routing, navigation, history commits, state synchronization, message
  jumps, and canonicalization.
- Retained D owner: `src/ts/router.test.ts` keeps 32 tests for initial pending
  application, settings/persona store wiring, history markers and traversal,
  module-editor guards, message jumps, active-generation navigation,
  canonicalization, stale-route races, and playground freshness.

Five direct settings slug/path cases moved out of the browser suite. The Node
matrix expands their coverage across all route families while the retained
Source Code, bare-settings, and persona cases continue to prove planner wiring
through real history, location, stores, and commands.

## Measurements

Before the ownership split, the 37-test Happy-DOM router owner passed in 1.86s
Vitest duration and 2.58s measured wall, with 552ms transform, 147ms import,
1.46s tests, 110ms environment, and 800,824 KiB peak RSS.

After the split, the eight-test Node owner passed in 149ms Vitest duration and
0.80s measured wall, with 9ms import, 6ms tests, no environment time, and
235,012 KiB peak RSS. The retained 32-test Happy-DOM owner passed in 1.86s and
2.53s wall, with 142ms import, 1.47s tests, 110ms environment, and 775,232 KiB
peak RSS.

The focused Happy-DOM result is unchanged within noise. This slice is retained
for correctness and maintainability: it gives the production planner a broad,
fast, environment-independent matrix and removes browser-only ownership from
pure route vocabulary without weakening the integration oracle. It is not
counted as a focused or phase-level performance improvement.

Complete current-source results:

| Scope | Result | Vitest | Wall | Peak RSS KiB |
| --- | --- | ---: | ---: | ---: |
| Node | 192 files / 1,285 tests | 4.84s | 5.57s | 1,033,712 |
| Happy-DOM standalone | 328 files / 5,174 tests | 62.71s | 63.60s | 4,946,704 |
| Ordinary frontend | 531 files / 6,423 tests | 69.72s | 70.63s | 4,909,096 |

The ordinary observation is inside the Phase 3 warm range and is not the Phase
4 performance claim. Closeout owns the required cold plus three-run warm
benchmark.

## Validation

- New Node owner: 1 file / 8 tests passed.
- Retained Happy-DOM owner: 1 file / 32 tests passed.
- Complete Node, Happy-DOM, and ordinary frontend runs passed.
- Full discovery is 539 files at 192 N / 17 S / 330 D; aggregate ordinary is
  531 files at 191 N / 17 S / 323 D.
- Inventory regeneration and exhaustive/disjoint verification passed.
- Formatting, type checks, affected routing, UI coverage, browser smoke, and
  aggregate closeout validation are owned by the Phase 4 closeout batch.

## Rollback

Remove `routerRoute.test.ts` from Node ownership and restore the five direct
settings path cases to `router.test.ts`. The production leaf is unchanged, so
no application, data, or protocol rollback is involved.

