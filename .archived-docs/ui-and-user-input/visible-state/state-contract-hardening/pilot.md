# UI State Contract Test Plan

Date: 2026-06-10

Status: archived, completed.

Archived: 2026-06-10.

This archived workstream borrowed the invariant-and-regression discipline from
the archived v3 stability/performance plan, but it did not reopen v3 or grow
into another broad audit.

## Completion Summary

Completed on 2026-06-10 with the requested implementation-agent then
verification-agent loop for each slice.

Landed commits:

- `250d380c6 test: add chat list optimistic create DOM coverage`
- `a9e1e2799 test: add chat list optimistic delete DOM coverage`
- `eb863b3be test: add chat list selection DOM coverage`
- `9499a7bff test: add chat folder edit DOM coverage`

Delivered focused Svelte DOM contract coverage for `SideChatList.svelte` and
`ChatList.svelte`: baseline harnesses, optimistic create/delete visibility and
rollback, route/select DOM class movement, command fallback rollback, and
sidebar folder/edit parity.

Final focused validation passed:

- `pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts`
- `pnpm exec vitest run src/lib/SideBars/SideChatList.svelte.test.ts src/lib/Others/ChatList.svelte.test.ts`
- `pnpm exec prettier --check src/lib/SideBars/SideChatList.svelte.test.ts`

## Goal

Prevent regressions where the underlying application state is correct but the
rendered UI does not reflect it. The immediate pilot is the recent chat
create/delete/select family, but the plan defines a reusable agent workflow for
future state-to-UI drift.

The target end state is:

- State transitions that affect visible UI have a DOM assertion, not only a
  helper or fetch-payload assertion.
- Optimistic writes prove both sides of the contract: local state changes
  immediately, and rendered UI changes immediately.
- Rollbacks prove the same contract in reverse: state restores and the UI
  visibly restores.
- Full browser smoke is reserved for failures that need real Fastify projection,
  SSE, hydration, reload, route timing, or browser-only behavior.

## Investigation Summary

This plan consolidates three focused sub-agent investigations plus a local
review of `STRUCTURE.md`, the v3 archive, recent commits, and the current test
harness.

Key inputs:

- `.archived-docs/performance-and-stability/stability-audits/v3/plan.md`
- `.archived-docs/performance-and-stability/stability-audits/v3/phases/phase-5-client-write-path-correctness.md`
- `.archived-docs/performance-and-stability/stability-audits/v3/phases/phase-6-reactive-amplification-and-render.md`
- Recent commits:
  - `5965b023a fix: update chat selection optimistically`
  - `648dd3675 fix: show newly created chats immediately`
  - `4e43bcdca fix: remove deleted chats immediately`
- Current hotspot files:
  - `src/lib/SideBars/SideChatList.svelte`
  - `src/lib/Others/ChatList.svelte`
  - `src/ts/chatCommands.ts`
  - `src/ts/router.ts`
  - `src/ts/server/chatBridge.svelte.ts`
  - `src/ts/bootstrap.ts`
  - `server/fastify/src/routes/commands.ts`

The investigations agreed on three useful facts:

- The recent recurring failures sit at the boundary between command/projection
  state and rendered Svelte surfaces.
- The repo already has strong helper, bridge, guard, and command tests, but the
  chat/list workflows still need direct DOM assertions for the visible rows and
  selected state.
- The existing browser smoke hook is appropriate for projection/SSE/route timing
  regressions, but most chat-list drift should be caught faster with Svelte
  component tests.

## V3 Principles To Carry Forward

V3 Phase 5 and Phase 6 are the right precedent, but this should stay smaller
than a v3-sized workstream.

Carry these principles forward:

- Fastify owns durable state; browser state is a guarded projection.
- Optimistic UI writes must happen in trusted projection write scopes and route
  durable persistence through commands.
- Projection guard proxy re-minting is intentional; consumer fixes should use
  stable signatures, keyed identity, scoped dependencies, and render/DOM proofs.
- Every fix needs a focused regression test that proves the broken contract.
- Broad paths remain broad only when they are true full-corpus flows. UI drift
  fixes should prefer scoped state and scoped tests.
- Gate only when useful. A lightweight registry is optional if this expands
  beyond the pilot; do not create a completeness gate before there are enough
  scheduled fixes to justify maintaining it.

## Core Invariant

If a code change affects a value that the user can see, the test must assert the
visible result after the same state transition.

For chat create/delete/select, that means it is not enough to prove:

- `DBState.db.characters[0].chats` changed
- `chatPage` changed
- a command payload was sent
- a rollback function restored state

The matching test must also prove:

- the new/deleted/selected chat row appears, disappears, or changes class
- the modal/sidebar surface uses the same selected chat as state
- the DOM updates before command resolution for optimistic paths
- the DOM rolls back after command failure

## Detection Heuristics

The agent should require a state-to-DOM test when a diff touches any of these
state or projection signals:

- `DBState`, `selectedCharID`, `chatPage`, `loadedStore`
- `withTrustedServerProjectionWrite`, projection guard, bootstrap, resync, SSE
- `runOptimisticCommandSequence`, `restore*`, `current*Snapshot`
- command helpers under `src/ts/*Commands.ts`
- bridge watchers under `src/ts/server/*Bridge.svelte.ts`
- router navigation that selects or reveals state
- array mutations such as `splice`, `unshift`, reorder maps, and folder moves
- `$derived`, `$effect`, keyed lists, memo signatures, and render dependency keys

The agent should also flag a missing DOM test when a bug fix touches both a
state/helper file and a Svelte surface. The recent chat commits match that
pattern exactly: helper tests exist in `src/ts/chatCommands.test.ts`, but the
actual user-visible fixes also changed `SideChatList.svelte` and
`ChatList.svelte`.

## Test Rings

Use the smallest ring that proves the contract.

1. State/helper Vitest
   - Use for pure state transitions, command payloads, rollback snapshots,
     projection guard behavior, and clone/render cost probes.
   - Existing examples: `src/ts/chatCommands.test.ts`,
     `src/ts/server/chatBridge.svelte.test.ts`,
     `src/lib/Others/projectionGuard.test.ts`.

2. Svelte component DOM Vitest
   - Use when a rendered row, class, button, modal, list, or input must reflect
     state.
   - Use Svelte's native `mount`, `tick`, `flushSync`, and `unmount` pattern
     already present in the repo.
   - Seed `DBState.db` and stores directly, stub network/alerts/router as needed,
     and assert DOM text/classes/attributes after the transition.

3. Fastify browser smoke
   - Use only when the failure depends on a real browser plus Fastify: bootstrap,
     active writer, projection reload, SSE reconciliation, hydration, full route
     timing, durable command round trips, or reload persistence.
   - Existing hook: `src/ts/server/browserSmoke.ts`.
   - Browser assertions should compare server command result, projected database
     snapshot, URL/route state, and visible DOM when possible.

## Pilot Scope

### Slice 1: Chat List DOM Harness

Add focused component tests for:

- `src/lib/SideBars/SideChatList.svelte`
- `src/lib/Others/ChatList.svelte`

Use the repo's current component-test style:

- create a `target` element and append it to `document.body`
- seed `DBState.db` and `selectedCharID`
- mount the component
- click real DOM buttons
- `await tick()`
- unmount and clear globals in `afterEach`

Mock or isolate noisy dependencies:

- `sortablejs` for sidebar drag setup
- `src/ts/alert` for confirm/error/input flows
- `src/ts/router` for navigation intent
- command fetch responses for optimistic success/failure timing

Avoid a large shared helper initially. If the second or third component test
duplicates the same setup, extract a small local fixture builder in the test
file.

### Slice 2: Optimistic Create

Cover the recent "new chat does not appear immediately" regression.

Required assertions:

- clicking create produces a new chat row before the command fetch resolves
- the new chat is selected in state and has the selected DOM class
- navigation is requested with the new chat id when a character id exists
- command failure rolls back state and removes the optimistic row from DOM

Run this for `SideChatList.svelte` first, then add the modal `ChatList.svelte`
path because it has separate handlers and calls `close`.

### Slice 3: Optimistic Delete

Cover the recent "deleted chat remains visible" regression.

Required assertions:

- confirmed delete removes the row before the command fetch resolves
- the fallback selected chat is selected in state and in DOM
- root rows and foldered rows are both covered, because sidebar rendering has
  duplicated row paths
- command failure restores the deleted row and selected class
- one-chat delete still reports `language.errors.onlyOneChat` and leaves DOM
  unchanged

### Slice 4: Select / Route / DOM

Cover the "chatPage changes but selection UI lags" class of regression.

Required assertions:

- clicking a chat row with `chaId` and `chat.id` calls `navigate` with
  `characterRoutePath(chaId, chat.id)`
- after the route/store selection is applied, `.bg-selected` moves to the
  clicked row
- the command fallback path still optimistically updates `chatPage` and the DOM
  when navigation is unavailable
- command failure restores the selected class to the previous row

### Slice 5: Folder And Edit Parity

Add after the create/delete/select pilots are green.

Recommended assertions:

- foldered chat rows use the original chat index, not folder-local position
- folded folders hide their rows without losing selection state
- chat and folder rename commands target the correct stable id
- folder toggle dispatches `dispatchUpdateChatFolder(folder.id, { folded })`
- reorder payload tests can stay lower priority unless a drag/regression touches
  `Sortable` behavior

## Agent Workflow

For future changes, the agent should follow this checklist before finishing:

1. Scan the diff for the detection signals above.
2. Identify the visible surface that should reflect the changed state.
3. Check whether an existing test proves only state/helper behavior.
4. Add the smallest DOM or browser assertion that proves the user-visible
   contract.
5. Include rollback/failure behavior for optimistic paths.
6. Run the focused command first, then broader validation when the touched
   surface warrants it.

A fetch-payload assertion alone does not count when the bug class is "the UI did
not update."

## Optional Gate Shape

Start without a new gate. If the pilot expands into several independent fixes,
add a small registry test instead of copying the full v3 machinery.

The registry should track only active slices in this plan:

- slice id
- owning files
- required test path
- required test name
- status: `PLANNED` or `DONE`

The gate should fail when a `DONE` slice points at a missing test, but it should
not parse archived v1/v2/v3 plans or audit finding IDs. Those archives already
have their own live gates.

## Validation Commands

Focused pilot validation:

```bash
pnpm exec vitest run \
  src/lib/SideBars/SideChatList.svelte.test.ts \
  src/lib/Others/ChatList.svelte.test.ts \
  src/ts/chatCommands.test.ts \
  src/ts/globalApi.changeChatTo.test.ts \
  src/ts/router.test.ts \
  src/ts/server/chatBridge.svelte.test.ts \
  src/lib/Others/projectionGuard.test.ts
```

Component-test harness sweep:

```bash
pnpm exec vitest run 'src/**/*.svelte.test.ts'
```

Broader validation after implementation:

```bash
pnpm test
pnpm smoke:fastify-browser
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Use `pnpm smoke:fastify-browser` only when the implementation touches browser
smoke hooks, route/projection timing, hydration, SSE, or reload persistence.
Use `pnpm check` only when the changed Svelte surface warrants it, and compare
against the documented existing baseline rather than treating unrelated
pre-existing diagnostics as part of this plan.

Documentation-only edits should use:

```bash
pnpm exec prettier --check docs/plan/ui-state-contract-tests.md
git diff --check
```

## Exit Criteria

- `SideChatList.svelte.test.ts` covers optimistic create/delete/select DOM
  behavior, including rollback.
- `ChatList.svelte.test.ts` covers the modal create/delete/select path and
  close behavior.
- At least one foldered-row case proves sidebar index/id parity.
- The plan's detection checklist is used in future fixes touching state and UI
  together.
- Focused validation is green; broader validation is run according to the
  touched surface.

## Out Of Scope

- No rewrite of the projection, routing, or command model.
- No blanket Playwright conversion for component-level drift.
- No new v3-style completeness gate unless this grows beyond the chat pilot into
  a multi-phase remediation stream.
- No broad shared testing framework until repeated component tests justify it.
