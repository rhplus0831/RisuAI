# Phase 4 Slice: Chat Import Request Planning

Status: Complete

## Scope

Extract the deterministic full-create versus metadata-plus-tail request planner
from `src/ts/chatCommands.ts` into a plain TypeScript leaf. Move boundary,
greedy chunking, UTF-8 sizing, anchor, and rejection matrices to Node while
retaining real durable-command, outbox, transport, rollback, and production
payload-limit proof in Happy-DOM.

The slice changes no user-visible import behavior, command ordering, mutation
ownership, persistence, rollback, or error semantics.

## Source And Capability Boundaries

- Current D owner: `src/ts/chatCommands.test.ts`, which imports the Svelte
  resource/database graph, IndexedDB outbox, browser transport, and command
  projection owners.
- New N owner: `src/ts/chatImportPlanning.test.ts`, which imports only
  `src/ts/chatImportPlanning.ts` and executes without Svelte transformation or
  DOM globals.
- Production caller: `importedChatDurableSteps` in `src/ts/chatCommands.ts`.
  It still owns snapshot creation, payload measurement through the real outbox
  serializer, durable command closures, staging, and rollback.
- Pure leaf inputs: detached full and metadata chat snapshots, detached message
  snapshots, character/chat ids, selection state, payload limit, and an exact
  payload-byte measurer. Outputs are ordered create/tail request data plus
  accepted-prefix lengths.

## Behavior And Test Ownership

The Node matrix covers exact-boundary full creates, encoded paths, greedy tail
packing, stable anchors and accepted-prefix lengths, UTF-8 envelope sizing,
metadata overflow, individual-message overflow, missing anchors, and empty
oversized plans.

The retained D suite still proves the real `16 * 1024 * 1024` limit, exact
metadata-create and ordered tail request bodies, the accepted-prefix rollback
after a terminal second-tail rejection, an unchunkable import's no-send and
projection rollback, encrypted outbox staging, batch reservation, and command
ordering. One duplicate production-sized chunking case was consolidated into
the terminal-prefix integration case; six Node cases replace its planning
matrix, changing aggregate ordinary coverage by +1 file and +5 tests.

## Measurements

The focused pre-change D observation passed 1 file / 184 tests in 8.21s Vitest
duration, with 5.08s test-body time and 8.94s measured wall. After extraction,
the retained D owner passed 1 file / 183 tests in 7.01s Vitest duration, with
4.03s test-body time and 7.70s wall. The new Node owner passed 1 file / 6 tests
in 163ms Vitest duration.

The complete aggregate-ordinary Node project passed 189 files / 1,265 tests in
4.38s Vitest duration and 5.09s wall. Happy-DOM passed 324 files / 4,986 tests
in 59.91s Vitest duration and 60.76s wall. The ordinary frontend passed 530
files / 6,418 tests in 68.94s Vitest duration and 69.80s wall, with 4,842,688
KiB peak RSS.

The focused 1.05s test-body reduction is the intended sequential-work
mechanism. The single ordinary observation lies inside the Phase 3 warm range
and is not a phase-level performance claim; Phase 4 closeout owns the required
three-run comparison.

## Validation

- New Node owner: 1 file / 6 tests passed.
- Retained Happy-DOM owner: 1 file / 183 tests passed.
- Complete Node, Happy-DOM, and ordinary frontend runs passed.
- Affected routing selected frontend, performance, and server lanes; execution
  passed 536 frontend files / 6,621 tests, 2 performance files / 6 tests, and
  154 server files / 3,295 tests with 1 skip.
- `pnpm check` passed with zero errors and warnings.
- Frontend inventory regeneration and exhaustive/disjoint check passed at 538
  full files, 536 standalone ordinary files, and 530 aggregate ordinary files.
- Formatting and `git diff --check` passed.

Exact commands and timings are in
[`../../../latest-verification.md`](../../../latest-verification.md).

## Rollback

Inline `planImportedChatRequests` into `chatCommands.ts`, restore the
consolidated Happy-DOM case, remove the Node allowlist/inventory entry, and
delete the leaf and its Node test. No data or protocol migration is involved.
