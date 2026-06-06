# Slice: Send Clone-Count Probe

Phase: [0](../../phase-0-baseline-and-gate.md). No runtime change.

## Scope

Add test-only instrumentation that counts `cloneJsonValue` / `structuredClone`
work across one simulated plain send on the client. This is the before/after
proof surface for Phase 1 M4/M5: the current baseline should expose the send
path's transcript and character-row clone cost, and the later fix slices should
flip those counts downward without changing runtime instrumentation.

## Anchors

- Existing clone harness:
  `src/ts/__tests__/cloneCostHarness.ts` (`withAsyncCloneInstrumentation`,
  `seedCloneCostDb`).
- Send UI and command path:
  `src/lib/ChatScreens/DefaultChatScreen.svelte`,
  `src/ts/chatCommands.ts` (`currentChatScopedSnapshot`,
  `dispatchReplaceMessagesWith`, `appendCurrentChatUserMessageForSend`).
- Send context rollback path:
  `src/ts/process/sendChatContext.ts`.
- Character-row rollback path:
  `src/ts/characterCommands.ts` (`CharacterSelectionSnapshot`,
  `restoreCharacterSelection` family).
- Existing send tests:
  `src/ts/process/__tests__/sendChatContext.test.ts`,
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`.

## Target Shape

- Add a test-only helper, for example `src/ts/__tests__/sendCloneCountProbe.ts`,
  that seeds a multi-character DB with a hydrated active transcript and drives
  the narrowest realistic plain-send body available in tests.
- Instrument both clone primitives by reusing or extending
  `withAsyncCloneInstrumentation`; report a structured result such as:
  `{ jsonCloneCount, structuredCloneCount, totalCloneCount, maxClonedSize,
  messageCount, characterCount, persistedWholeTranscript }`.
- The simulated send should avoid provider/network cost by using existing mocks
  or a deterministic server-backed fixture. The count is about client send
  preparation and rollback state, not upstream generation latency.
- Add a focused probe test, for example
  `src/ts/__tests__/sendCloneCountProbe.test.ts`, that records the current
  pre-fix count shape without asserting wall-clock timing.
- The probe must be reusable by Phase 1 tests after M4 and M5 land; keep the
  output stable enough for `latest-verification.md` to record exact counts.

## Invariants

- No production instrumentation hooks, flags, or counters.
- All global spies/mocks are restored in `finally` or test teardown.
- The fixture must be deterministic under Vitest/jsdom and must not require a
  browser dev server.
- Count clone primitive invocations and payload size, not elapsed time.
- Plain send means no trigger-rewritten transcript path; trigger/editinput
  sends keep their existing broader replacement behavior until their own slice.

## Done Criteria

- A focused probe test returns stable clone counts for one plain send with a
  fixed fixture size.
- The result distinguishes whole-transcript / whole-character-row clones from
  scalar or single-row clones by `maxClonedSize` and fixture dimensions.
- The test output is suitable for the Phase 0 verification entry.
- Existing clone-cost gate tests still pass.

## Validation

```bash
pnpm exec vitest run src/ts/__tests__/sendCloneCountProbe.test.ts src/ts/__tests__/cloneCostGateCompleteness.test.ts
```
