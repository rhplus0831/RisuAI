# sendChat Fixtures

Date: 2026-05-20 (scaffolding + 8 fixtures landed)

Status: scaffolding landed; eight fixtures cover the entry path,
the multiline reroll branch, the upstream-fail branch, the
auto-continue recursion, and two prompt-shape pins (author note
and automatic cache point). Nine fixtures still to author.

Snapshot schema bumped 2026-05-20: `providerCalls` is now an
array of normalized call records (`{ mode, formated, ... }`)
rather than a count. The `formated` field is the main pin for
prompt-shape fixtures.

## Fixture inventory

| Name                  | Pins                                                   | Status      |
| --------------------- | ------------------------------------------------------ | ----------- |
| `simple-send`         | One user message, OpenAI, no lorebook / memory.        | landed      |
| `continue`            | Resume an existing assistant message.                  | landed      |
| `regenerate`          | Multiline response: first becomes the message, rest go to `addRerolls`. | landed |
| `preview`             | Preview mode: no provider call.                        | landed      |
| `lorebook-keyword`    | One keyword-activated lorebook entry.                  | not started |
| `lorebook-constant`   | One constant lorebook entry.                           | not started |
| `lorebook-recursive`  | Recursion stays within the budget.                     | not started |
| `hypav3-memory`       | One Hypa V3 summary slot consumed in the prompt.       | not started |
| `author-note`         | `chats[].note` appended as the last system message under the default `formatingOrder`. | landed |
| `persona`             | Non-default persona substitution.                      | not started |
| `multimodal-image`    | One attached image is passed to the provider.          | not started |
| `cache-point`         | `automaticCachePoint` marks the last 3 user entries with `cachePoint: true`. Requires a `promptTemplate` with a `chat` card. | landed |
| `editrequest-trigger` | A triggerscript rewrites the request payload.          | not started |
| `editoutput-trigger`  | A triggerscript rewrites the response text.            | not started |
| `auto-continue`       | Auto-continue fires once and lands a second turn.      | landed      |
| `provider-error`      | Upstream `type:'fail'` produces a `risuerror` chat message. | landed |
| `client-abort`        | Client abort produces restoration patches.             | not started |

## Loader

`src/ts/process/__fixtures__/loadFixture.ts` owns:

- Loading a canned database from
  `src/ts/process/__fixtures__/db/<name>.json` (JSON with optional
  `sendChatArgs` plus a partial `db` overlay).
- Installing it into `DBState` via `setDatabase()` so the full
  defaulting pass runs.
- Setting `selectedCharID` to the fixture's target (default `0`).
- Returning a `cleanup()` callback. The current implementation
  intentionally does not restore the prior `DBState.db` because
  doing so triggers reactive `$effect` listeners
  (`parser.svelte.ts:504-518`, `stores.svelte.ts:176-204`) against
  partial state and surfaces an unhandled error. Each fixture's
  `loadFixture()` reseeds wholesale, which is enough isolation for
  this harness.

## Provider fake

`src/ts/process/__fixtures__/providerFake.ts` replaces
`requestChatData` for the duration of a fixture run. The test file
wires it in via `vi.mock('../request/request', ...)`, so every
caller in the project (sendChat, stableDiff, triggers, scriptings,
memory, mcp) routes through the same fake.

Each line of
`src/ts/process/__fixtures__/upstream/<name>.jsonl` scripts one
provider call. Supported `type` values are `success`, `fail`,
`multiline`, and `streaming` (where `chunks` is an array of frame
objects). Preview fixtures may omit the file - the test tolerates
ENOENT when no provider call is expected.

The fake records every call (`arg` + `model`) and exposes the
sequence via `getProviderCalls()`. The snapshot harness persists
each call as a normalized record carrying `mode`, the full
`formated: OpenAIChat[]`, and a small set of opt-in scalars
(`continue`, `chatId`, `biasString`, `useStreaming`,
`imageResponse`, `previewBody`, `escape`). Scalars are only
emitted when set, so default-false flags do not appear in the
snapshot.

## Side-effect mocks

The test file also installs `vi.mock` shims for `tts`,
`inlayScreen`, `stableDiff`, and `prereroll`. Each shim records
its call via `recordSideEffect(fn, args)` with character objects
summarized down to `{ chaId, name }` so the snapshot stays
focused.

## Determinism

- `uuid.v4` is mocked to a monotonically incrementing
  `uuid-<n>` so `generationId` / `chatId` are stable.
- `vi.useFakeTimers({ toFake: ['Date'] })` plus
  `vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))` locks
  `Date.now()`. Stage timing measurements collapse to `0`.
- The snapshot harness normalizes `stageTiming` to all-zero
  defensively, and `messages` are projected through a normalizer
  that drops `time`.

## What the fixtures pin

- `currentChat.message` final array shape.
- `generationInfo` on the assistant row, including
  `stageTiming`, `promptInfo`, and token counts.
- The order of side-effect calls: `runInlayScreen`, `sayTTS`,
  `stableDiff`, `addRerolls`. The side-effect functions
  themselves are spied on, not executed.
- The sequence of `chatProcessStage` store writes.

## What the fixtures intentionally do not pin

- Wall-clock timings.
- Internal function call shapes (the next phase rewrites these).
- Provider-side network behavior (we use canned fakes).
