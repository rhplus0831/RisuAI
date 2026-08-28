# Phase 2 Slice: MCP And Transformer Helpers

Status: Complete

## Scope

Promote `src/ts/process/mcp/googlesearchclient.test.ts` and
`src/ts/process/transformers.test.ts`, totaling six tests, from Happy-DOM to
Node. Retain `src/ts/process/mcp/internalClients.test.ts` and its three internal
MCP integration tests in Happy-DOM after an exact broader Node probe.

No production code, test body, assertion, or mock changes in this slice.

## Capability And Behavior Boundaries

- The Google-search suite proves response parsing and normalized MCP result
  shaping with a supplied fetch response.
- The transformer suite proves GPU/CPU device selection and fallback with
  explicit capability inputs. Neither promoted suite uses Svelte, storage,
  DOM, browser globals, or real network behavior.
- The retained internal-client suite creates and re-creates the real filesystem
  MCP client to prove directory-handle permission, reuse, and invalidation. Its
  production handshake checks `showDirectoryPicker` through `window`.
- Faking `window` solely for promotion would weaken the browser capability
  contract, so the internal-client suite remains D-owned.

## Performance And Ownership Result

The three-file Happy-DOM owner passed 9 tests in 1.02s wall and 364ms Vitest
duration, with 401,720 KiB peak RSS and 333ms environment time. The broader
Node probe passed all six proposed tests and one internal-client test, while
two directory-handle cases failed with `window is not defined` at
`filesystemclient.ts:360`.

The exact two-file Node scope passed twice. The measured probe completed 6
tests in 1.03s wall and 277ms Vitest duration, with 272,252 KiB peak RSS and no
environment time; the repeat took 240ms Vitest duration.

The paired ordinary frontend distribution moved from 158 N / 2 S / 369 D to
160 N / 2 S / 367 D while retaining 529 files / 6,413 tests. Wall time moved
from 66.60s to 68.24s (+2.5%), Vitest duration from 65.76s to 67.42s, and peak
RSS from 4,696,532 KiB to 5,128,488 KiB (+9.2%). This remains inside the
ratified RSS guard and observed timing variability; it is slice evidence, not
a phase-level claim.

The Node project moved from 4.03s / 3.39s Vitest / 922,624 KiB to 4.38s /
3.70s / 1,058,464 KiB. The DOM project moved from 62.40s / 61.63s Vitest /
4,800,256 KiB to 63.54s / 62.74s / 4,761,868 KiB.

## Validation

- Exact and repeated Node probes passed all six promoted tests.
- Complete Node, DOM, and ordinary frontend runs passed 160 files / 947 tests,
  367 files / 5,458 tests, and 529 files / 6,413 tests.
- Inventory remained exhaustive and disjoint at full 161 N / 2 S / 374 D,
  standalone ordinary 161 N / 2 S / 372 D, and aggregate ordinary 160 N / 2 S
  / 367 D. Generated mismatches fell from 142 to 140.
- The affected plan passed 535 frontend files / 6,616 tests, 2 performance
  files / 6 tests, and 154 server files / 3,295 tests with 1 skipped.
- `pnpm format:check` and `git diff --check` passed.

Exact commands and source-state details are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Deferral And Rollback

`internalClients.test.ts` remains D-owned under the filesystem MCP browser
capability contract. Revisit only if that contract gains an equally faithful
non-DOM adapter.

To roll back the promotions, remove both paths from `vitest.node-tests.ts` and
regenerate the inventory. Happy-DOM will resume ownership without a production
rollback.
