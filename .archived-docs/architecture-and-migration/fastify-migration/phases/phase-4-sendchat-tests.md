# Phase 4 - sendChat Characterization Tests

Date: 2026-05-22

## Goal

Pin the observable behavior of the current
`src/ts/process/index.svelte.ts::sendChat` with fixture-driven
tests before any extraction or server move. The tests are the
safety net for Phases 5-9.

## Preconditions

- Phase 0 closed (so the function under test no longer has dead
  paths through group / multiuser / legacy memory).

Phase 4 ran in parallel with the server-side phases and is now
closed.

## Status

Done 2026-05-20. The landed harness lives at
`src/ts/process/__tests__/sendChat.fixtures.test.ts` and
`src/ts/process/__fixtures__/`. All 17 initial fixtures listed
below have expected snapshots; Phase 5 later added 9 narrow gate
fixtures and Phase 6 added 12 provider parity fixtures, bringing
the active local suite to 38 snapshots.

## Scope

### Fixture loader

Write `src/ts/process/__fixtures__/loadFixture.ts` (or similar)
that:

- Loads a canned `Database` snapshot from
  `src/ts/process/__fixtures__/db/<name>.json`.
- Installs it into `DBState` via the same path the app uses on
  bootstrap.
- Sets `selectedCharID` to the canned target.
- Returns a `cleanup()` callback. As landed, the callback does not
  restore the prior `DBState`; each fixture reseeds wholesale, which
  avoids reactive teardown errors from
  `src/ts/parser/parser.svelte.ts` and `src/ts/stores.svelte.ts`.

### Provider fake

Replace `requestChatData` (the upstream entry point) with a fake
during tests:

- Yields canned responses from
  `src/ts/process/__fixtures__/upstream/<name>.jsonl`.
- Each line is one scripted provider response with
  `type: 'success' | 'fail' | 'multiline' | 'streaming'`.
- The fake is installed with `vi.mock('../request/request', ...)`
  in the test file, keeping `sendChat`'s production signature
  unchanged.

### Snapshot the outputs

For each fixture run, capture:

- The sequence of `chatProcessStage` writes.
- The final `currentChat.message` array.
- The `generationInfo` recorded on the assistant row (including
  `stageTiming`, `promptInfo`, `tokens`).
- The order of side effects (`runInlayScreen` calls,
  `sayTTS` calls, `stableDiff` calls, `addRerolls` calls). These
  are recorded by spying on the functions, not by running them.
- The final `doingChat` value, so the harness pins that `sendChat`
  clears the lease it owns.

Compare against `src/ts/process/__fixtures__/expected/<name>.json`.
First run records and fails loudly; subsequent runs assert. Set
`UPDATE_FIXTURES=1` to overwrite existing snapshots intentionally.

### Initial fixture set

Aim for breadth, not depth. Each fixture is a single character
chat under specific conditions:

- `simple-send` - one user message, OpenAI provider, no lorebook,
  no memory, no triggers.
- `continue` - resume an assistant message.
- `regenerate` - reroll an existing assistant message.
- `preview` - preview mode; assert no provider call.
- `lorebook-keyword` - one keyword-activated entry.
- `lorebook-constant` - one constant entry.
- `lorebook-recursive` - recursion within budget.
- `hypav3-memory` - one summary slot consumed.
- `author-note` - appended as the last system message under the
  default `formatingOrder` (the current behavior differs from the
  old "configured depth" expectation).
- `persona` - non-default persona.
- `multimodal-image` - one image attached.
- `cache-point` - one prompt with a `cachePoint` marker.
- `editrequest-trigger` - a triggerscript that rewrites the
  request.
- `editoutput-trigger` - a triggerscript that rewrites the
  response.
- `auto-continue` - auto-continue fires once.
- `provider-error` - provider fake returns `type: 'fail'`; assert
  the error-message path.
- `client-abort` - pre-aborted signal; the provider fake still
  records the call, then `sendChat` exits before adding an
  assistant message.

Each fixture is small enough to read in one screen. During Phase 5
the set grew as extraction surfaced hidden coupling. The completed
gate list is tracked in
the archived sendChat slicing log.

### Test config

`vitest` already exists; the new tests go under
`src/ts/process/__tests__/sendChat.fixtures.test.ts`.

Run only this suite with
`pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts`.

## Boundaries

- **Do not refactor sendChat.** Read it, do not rewrite it. The
  point of this phase is to make rewriting safe in Phase 5, not
  to do the rewrite.
- **Do not test internal call shapes.** Test what an observer
  sees: messages, generation info, side-effect order. The next
  phases will rewrite the internals; tests that pin function
  boundaries become brittle.
- **Do not run real providers.** Every upstream is a fake.
- **Do not add fixtures for removed features.** No group chat, no
  peer sync, no Supa / Hypa V2 / Hanurai. If Phase 0 did not
  delete a path that the fixture would exercise, the path stays;
  add a fixture for it.

## Exit criteria

- The 17 initial fixtures listed above run and pass.
- `pnpm exec vitest run src/ts/process/__tests__/sendChat.fixtures.test.ts`
  runs in under 30 seconds on a developer machine.
- `coverage-records/sendchat-fixtures.md` lists the fixtures and any
  intentionally uncovered behavior.
- The fixture loader and provider fake are reusable - they are the
  scaffolding Phase 5 builds on.

## Reference

- `risuai-metatron/server-py/tests/test_generation_route_*.py`
  has the closest pattern at scale: per-feature fixtures, recorded
  expected SSE streams, asserted message rows. We are not running
  in Python, but the test layout (one fixture per behavior, named
  after the behavior) translates directly.
