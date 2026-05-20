# Phase 4 - sendChat Characterization Tests

Date: 2026-05-20

## Goal

Pin the observable behavior of the current
`src/ts/process/index.svelte.ts::sendChat` with fixture-driven
tests before any extraction or server move. The tests are the
safety net for Phases 5-9.

## Preconditions

- Phase 0 closed (so the function under test no longer has dead
  paths through group / multiuser / legacy memory).

Phase 4 can run in parallel with Phases 1-3.

## Scope

### Fixture loader

Write `src/ts/process/__fixtures__/loadFixture.ts` (or similar)
that:

- Loads a canned `Database` snapshot from
  `src/ts/process/__fixtures__/db/<name>.json`.
- Installs it into `DBState` via the same path the app uses on
  bootstrap.
- Sets `selectedCharID` to the canned target.
- Returns a `cleanup()` that restores the prior state.

### Provider fake

Replace `requestChatData` (the upstream entry point) with a fake
during tests:

- Yields canned chunks from
  `src/ts/process/__fixtures__/upstream/<name>.jsonl`.
- Each line is `{ type: 'token' | 'tool_call' | 'done' | ...,
payload: ... }`.
- The fake is installed via dependency injection on `sendChat`'s
  importable seam; we add a parameter or a module-level
  override - whichever is least invasive.

### Snapshot the outputs

For each fixture run, capture:

- The sequence of `chatProcessStage` writes.
- The final `currentChat.message` array.
- The `generationInfo` recorded on the assistant row (including
  `stageTiming`, `promptInfo`, `tokens`).
- The order of side effects (`runInlayScreen` calls,
  `sayTTS` calls, `stableDiff` calls, `addRerolls` calls). These
  are recorded by spying on the functions, not by running them.

Compare against `src/ts/process/__fixtures__/expected/<name>.json`.
First run records; subsequent runs assert.

### Initial fixture set

Aim for breadth, not depth. Each fixture is a single character
chat under specific conditions:

- `simple-send` - one user message, OpenAI provider, no lorebook,
  no memory, no triggers.
- `continue` - resume an assistant message.
- `regenerate` - reroll an existing assistant message.
- `preview` - preview-prompt mode; assert no provider call.
- `lorebook-keyword` - one keyword-activated entry.
- `lorebook-constant` - one constant entry.
- `lorebook-recursive` - recursion within budget.
- `hypav3-memory` - one summary slot consumed.
- `author-note` - injected at the documented depth.
- `persona` - non-default persona.
- `multimodal-image` - one image attached.
- `cache-point` - one prompt with a `cachePoint` marker.
- `editrequest-trigger` - a triggerscript that rewrites the
  request.
- `editoutput-trigger` - a triggerscript that rewrites the
  response.
- `auto-continue` - auto-continue fires once.
- `provider-error` - upstream returns 500; assert cleanup patches.
- `client-abort` - signal aborts mid-stream; assert restoration.

Each fixture is small enough to read in one screen. The set grows
in Phase 5 as extraction surfaces hidden coupling.

### Test config

`vitest` already exists; the new tests go under
`src/ts/process/__tests__/sendChat.fixtures.test.ts`.

Run with `pnpm test -- sendChat.fixtures`.

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
- `pnpm test -- sendChat.fixtures` runs in under 30 seconds on a
  developer machine.
- `coverage/sendchat-fixtures.md` lists the fixtures and any
  intentionally uncovered behavior.
- The fixture loader and provider fake are reusable - they are the
  scaffolding Phase 5 builds on.

## Reference

- `risuai-metatron/server-py/tests/test_generation_route_*.py`
  has the closest pattern at scale: per-feature fixtures, recorded
  expected SSE streams, asserted message rows. We are not running
  in Python, but the test layout (one fixture per behavior, named
  after the behavior) translates directly.
