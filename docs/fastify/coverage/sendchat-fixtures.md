# sendChat Fixtures

Date: 2026-05-22 (26 snapshots; Phase 5 closed)

Status: the 17 initial Phase 4 fixtures landed, and Phase 5 has
added nine narrow gate fixtures. The harness pins the entry path,
the multiline reroll branch, the upstream-fail branch, the
auto-continue recursion, prompt-shape variations, Hypa V3 memory,
trigger transformation paths, prompt-template gates, lorebook
placement, history-media fallback, start-trigger mutation / stop,
prompt-info text capture, preview-prompt early return, and the
pre-aborted-signal exit path. The historical gate list lives in
[`../status/sendchat-slicing.md`](../status/sendchat-slicing.md).

Snapshot schema bumped 2026-05-20: `providerCalls` is now an
array of normalized call records (`{ mode, formated, ... }`)
rather than a count. The `formated` field is the main pin for
prompt-shape fixtures. The schema also records final `doingChat`;
all current snapshots assert it is `false`.

## Fixture inventory

| Name                  | Pins                                                   | Status      |
| --------------------- | ------------------------------------------------------ | ----------- |
| `simple-send`         | One user message, OpenAI, no lorebook / memory.        | landed      |
| `continue`            | Resume an existing assistant message.                  | landed      |
| `regenerate`          | Multiline response: first becomes the message, rest go to `addRerolls`. | landed |
| `preview`             | Preview mode: no provider call.                        | landed      |
| `lorebook-keyword`    | One keyword-activated entry on `globalLore`; matched substring in the user message. Content lands at the `lorebook` slot in `formatingOrder`. | landed |
| `lorebook-constant`   | One entry with `alwaysActive: true` and no `key`. Activates without a substring scan and lands at the lorebook slot. | landed |
| `lorebook-recursive`  | Two entries chained by keyword: A's content mentions B's keyword. User message contains A's keyword; recursive scan activates B. Final block order is sort-by-`insertorder`-desc then reversed. | landed |
| `hypav3-memory`       | `vi.mock` of `memory/hypav3` returns a canned summary; the entry survives into `formated` wrapped as `<Previous Conversation>...</Previous Conversation>` with `memo: "hypaMemory"`. Stages emit `[1, 2, 1, 3, 4]`. | landed |
| `author-note`         | `chats[].note` appended as the last system message under the default `formatingOrder`. | landed |
| `persona`             | `db.personaPrompt` set. Lands in `unformated.personaPrompt`; under default `formatingOrder`, gets merged into the leading system block by `pushPrompts`. | landed |
| `multimodal-image`    | `{{inlay::<id>}}` tag in a user message resolves via mocked `getInlayAsset` into the `multimodals: [{ type: 'image', base64, width, height }]` field on the user `OpenAIChat`. Uses a custom `xcustom:::` model with `hasImageInput`. | landed |
| `cache-point`         | `automaticCachePoint` marks the last 3 user entries with `cachePoint: true`. Requires a `promptTemplate` with a `chat` card. | landed |
| `prompt-template-basic` | Template with `persona`, `description`, `authornote`, `plain`, `chatML`, and `chat`, with implicit `postEverything` insertion visible through chain-of-thought. | landed |
| `utility-bot-template` | `utilityBot: true` with no user template forces the six-card utility template and replaces the default main / global-note sections. | landed |
| `prompt-template-memory-cache` | Template `memory` card wraps the Hypa V3 mock summary; explicit `cache` card marks the intended user messages and suppresses automatic cache walk-back. | landed |
| `lorebook-position-depth` | Pins lorebook `before_desc`, `after_desc`, `@@depth`, `@@reverse_depth`, named `@@position`, and `{{position::...}}` placement. | landed |
| `history-media-fallback` | No-vision model plus `{{inlay::test-image}}` appends a mocked image caption and strips the inlay tag. | landed |
| `start-trigger-control` | Start trigger mutates chat history; the injected user message reaches persisted history and the provider prompt. | landed |
| `start-trigger-stop` | Start trigger returns `stopSending`; sendChat exits after Stage 1 with no provider call, side effects, or new assistant row. | landed |
| `prompt-info-text` | `promptInfoInsideChat` + `promptTextInfoInsideChat` store the raw prompt-template text after the `editRequest` trigger. | landed |
| `preview-prompt` | `previewPrompt` sends the provider request with `previewBody: true`, stores `previewBody`, and exits without persisting a new assistant row. | landed |
| `editrequest-trigger` | Full `vi.mock` of `scriptings` (wasmoon can't initialize under happy-dom). The fake `runLuaEditTrigger` appends a marker system entry when the character has a non-empty `triggerscript` and `mode === 'editRequest'`. | landed |
| `editoutput-trigger`  | One `customscript` regex entry of `type: 'editoutput'` rewriting `sunshine` -> `starlight`. The rewrite fires inside the extracted streaming loop's `processScriptFull('editoutput', ...)` at `src/ts/process/postGeneration/streamResponse.ts:102`. | landed |
| `auto-continue`       | Auto-continue fires once and lands a second turn.      | landed      |
| `provider-error`      | Upstream `type:'fail'` produces a `risuerror` chat message. | landed |
| `client-abort`        | Pre-aborted `AbortSignal`. Provider call still fires (our fake ignores the signal), but the post-provider check in `src/ts/process/dispatch/dispatchRequest.ts:127` returns the aborted union and the coordinator exits before any assistant message is added. | landed |

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
  (`src/ts/parser/parser.svelte.ts:504-518`,
  `src/ts/stores.svelte.ts:176-204`) against
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
- The final `doingChat` store value after `sendChat` exits.

## What the fixtures intentionally do not pin

- Wall-clock timings.
- Internal function call shapes (server-side phases may rewrite these).
- Provider-side network behavior (we use canned fakes).
