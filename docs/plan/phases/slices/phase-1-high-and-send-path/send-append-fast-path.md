# Slice: Send Append Fast Path

Phase: [1](../../phase-1-high-and-send-path.md). Depends on the Phase 0
send clone-count probe. Runtime change.

## Scope

Fix M4 by routing plain user sends through the existing single-message append
command instead of cloning and replacing the full active transcript. Keep the
full replace path only for flows that genuinely rewrite a transcript before
generation.

## Anchors

- `src/lib/ChatScreens/DefaultChatScreen.svelte`: `sendMain`, the current
  `currentChatScopedSnapshot` / cloned `cha` / `dispatchReplaceMessagesScoped`
  path, and the separate playground plus-button replace path.
- `src/ts/chatCommands.ts`: `currentChatScopedSnapshot`,
  `restoreChatScopedState`, `dispatchReplaceMessagesScoped`,
  `dispatchAppendMessage`, `appendCurrentChatUserMessageForSend`,
  `toMessageSnapshot`.
- `src/ts/server/commands.ts`: `appendMessageCommand`,
  `replaceMessagesCommand`, command result shapes.
- Event/projection consumers of `messages.appended` and `messages.replaced`
  in `src/ts/server/`.
- Tests: `src/ts/chatCommands.test.ts`,
  `src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts`, and the
  Phase 0 send clone-count probe.
- `src/ts/__tests__/fixCompletenessGateV3.test.ts` and
  `docs/plan/active-risk-analysis.md` for M4 gate registration.

## Target Shape

- In `sendMain`, avoid taking `currentChatScopedSnapshot()` and avoid cloning
  `currentChatRecord.message` for the plain append case. Build one user
  `Message` for the submitted input (including the existing `useSayNothing`
  and file-inlay behavior) and append only that row.
- Route that row through `appendCurrentChatUserMessageForSend` or a small
  refactor of the same helper. The helper should use `appendMessageCommand`
  and upload one serialized message, not the whole transcript.
- Replace the helper's current whole-chat rollback snapshot with an id-keyed
  rollback: if the append command fails, locate the chat and remove exactly
  the optimistically appended message id if it is still present. Do not
  restore the whole transcript.
- Preserve command and empty-input behavior:
  slash commands still short-circuit before sending; continue sends that do
  not append a user row should not invent one; send errors should not start
  provider generation for a message that failed to append.
- Keep `dispatchReplaceMessagesScoped` for real transcript replacement paths,
  including trigger/editinput-rewritten transcripts when that path is present,
  and for unrelated UI affordances such as the playground plus button.
- Re-verify client projection/event consumers for the switch from
  `messages.replaced` to `messages.appended` on plain sends.
- Register M4 as `DONE` in the v3 gate with focused behavior and clone-count
  tests, and flip only the M4 row in `active-risk-analysis.md` in the same
  change.

## Invariants

- A plain send performs no full-transcript JSON clone before generation.
- A plain send's server command body contains one message, not the active
  transcript.
- Failed append rollback removes only the row created by that send and does
  not delete later messages or projection updates.
- Trigger-rewritten or otherwise transformed transcript paths still replace
  the transcript through the existing replace command.
- Message ids remain stable between optimistic UI state and the server append
  response.

## Done Criteria

- The send clone-count probe shows the full-transcript clone count removed for
  a plain send, with before/after counts recorded for Phase 1 verification.
- A focused command test proves `appendMessageCommand` is used for a plain
  send and the request body is one message.
- A rollback test proves an append failure removes exactly the appended
  message id and preserves pre-existing and later messages.
- A replacement-path test proves rewritten transcripts still call
  `replaceMessagesCommand`.
- M4 is registered as `DONE` in the v3 gate and active-risk table, with no
  unrelated ID status changes.

## Validation

```bash
pnpm exec vitest run src/ts/chatCommands.test.ts src/ts/process/__tests__/sendChat.fixtures.serverBacked.test.ts src/ts/__tests__/sendCloneCountProbe.test.ts src/ts/__tests__/fixCompletenessGateV3.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
```
