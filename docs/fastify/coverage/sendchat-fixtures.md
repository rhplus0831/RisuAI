# sendChat Fixtures

Date: 2026-05-20

Status: none of these fixtures exist yet. Phase 4 builds the
scaffolding; the table below is the initial target set.

## Fixture inventory

| Name                  | Pins                                                   | Status      |
| --------------------- | ------------------------------------------------------ | ----------- |
| `simple-send`         | One user message, OpenAI, no lorebook / memory.        | not started |
| `continue`            | Resume an existing assistant message.                  | not started |
| `regenerate`          | Reroll an existing assistant message.                  | not started |
| `preview`             | Preview mode: no provider call.                        | not started |
| `lorebook-keyword`    | One keyword-activated lorebook entry.                  | not started |
| `lorebook-constant`   | One constant lorebook entry.                           | not started |
| `lorebook-recursive`  | Recursion stays within the budget.                     | not started |
| `hypav3-memory`       | One Hypa V3 summary slot consumed in the prompt.       | not started |
| `author-note`         | Author note injected at the configured depth.          | not started |
| `persona`             | Non-default persona substitution.                      | not started |
| `multimodal-image`    | One attached image is passed to the provider.          | not started |
| `cache-point`         | A `cachePoint` marker is preserved in the request.     | not started |
| `editrequest-trigger` | A triggerscript rewrites the request payload.          | not started |
| `editoutput-trigger`  | A triggerscript rewrites the response text.            | not started |
| `auto-continue`       | Auto-continue fires once and lands a second turn.      | not started |
| `provider-error`      | Upstream 500 produces restoration patches.             | not started |
| `client-abort`        | Client abort produces restoration patches.             | not started |

## Loader

Lives under `src/ts/process/__fixtures__/loadFixture.ts` (or
similar). Owns:

- Loading a canned database from
  `src/ts/process/__fixtures__/db/<name>.json`.
- Installing it into `DBState` and selecting the target chat.
- Returning a `cleanup()` callback that restores prior state.

## Provider fake

Replaces `requestChatData` for the duration of a fixture run.
Reads canned chunks from
`src/ts/process/__fixtures__/upstream/<name>.jsonl` and yields
them in order.

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
