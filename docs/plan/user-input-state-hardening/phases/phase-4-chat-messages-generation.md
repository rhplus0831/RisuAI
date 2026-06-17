# Phase 4: Chat, Messages & Generation

Status: active.

Goal: harden chat-facing async flows where delayed work can clear composer
state, edit the wrong message, reroll the wrong chat, or persist generation
output against a stale target.

## Scope

- Version composer state so send, continue, auto-translate, paste upload, and
  file-post callbacks cannot clear or append into newer user input. Composer
  file and paste callbacks are covered by Phase 3; composer send/continue
  clear/restore and auto-translate freshness has landed here.
- Re-check active chat after hydration and before reroll, unreroll, candidate
  select, truncate, tail replace, and regenerate operations. Reroll active-chat
  freshness has landed here.
- Guard partial edit and partial delete modals with message id, source range,
  and source data freshness. Partial edit/delete modal freshness has landed
  here.
- Guard dynamic rendered chat buttons and Lua trigger results before applying
  returned chat/message/script state.
- Guard suggestion reroll/send persistence while preserving existing request
  checks.
- Add generation finalization freshness checks for durable jobs and target-row
  persistence.

First landed slice: `DefaultChatScreen.svelte` now snapshots send/continue
composer operations by active transcript identity, latest-operation token,
composer mutation version, text, translated text, and files. Delayed append
success/failure and generation-prep clears only mutate a still-fresh composer,
send builds user messages from the captured snapshot, and stale auto-translate
results are dropped when the source text, target field version, or active
transcript changes.

Second landed slice: `DefaultChatScreen.svelte` reroll wrappers now capture
active transcript identity around hydration. `rerollNavigation.svelte.ts` issues
operation tokens scoped by selected character and stable chat id/index fallback,
then checks freshness before tail swaps, tail slices, truncate persistence, and
post-truncate generation. The guard is target-scoped, so leaving and returning
to the same chat may still be treated as fresh unless a newer same-target reroll
operation supersedes it.

Third landed slice: `PartialEditController.svelte` captures source data, source
range, operation mode, chat id, and message id when a partial edit/delete modal
operation opens. `Chat.svelte` resolves save details through
`partialEditFreshness.ts`, re-reading the live target before local mutation or
message patch dispatch. Legacy no-id fallback is limited to index/source-data
matching.

## Anchors

- `src/lib/ChatScreens/DefaultChatScreen.svelte`
- `src/lib/ChatScreens/Chat.svelte`
- `src/lib/ChatScreens/PartialEditController.svelte`
- `src/lib/ChatScreens/RerollList.svelte`
- `src/lib/ChatScreens/Suggestion.svelte`
- `src/ts/process/index.svelte.ts`
- `src/ts/process/rerollNavigation.ts`
- `src/ts/process/request/serverChat.ts`
- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/generationJobs.ts`

## Target Shape

- A send or continue that began from an older composer value cannot clear newer
  typed text.
- Auto-translate results are accepted only for the same source input and target
  field generation.
- Reroll actions lock to the original chat/message tail after every async
  boundary.
- Partial edit/delete fails or rebases safely if the message data changed while
  the modal was open.
- Generation result persistence verifies the target chat/message state that was
  assembled, or records an explicit conflict instead of overwriting newer
  transcript work.

## Exit Criteria

- Tests cover stale composer clear/restore, stale paste/file append, stale
  auto-translate result, reroll after chat switch, partial edit after message
  change, dynamic trigger after chat switch, and generation finalization after
  target row change.
- Chat/message rollback from Phase 1 is used instead of whole-chat restoration
  for the changed paths.
- Browser smoke covers at least composer/file/reroll or records why unit tests
  are sufficient.

## Validation

```bash
pnpm exec vitest run src/ts/process/request/tests/serverChat.test.ts \
  src/ts/process/request/tests/durableGeneration.test.ts \
  src/ts/process/rerollNavigation.test.ts \
  src/ts/process/files/multisend.test.ts
pnpm exec vitest run src/ts/chatCommands.test.ts
pnpm exec tsc -p tsconfig.client-lib.json
pnpm exec tsc -p server/fastify/tsconfig.json --noEmit
```

Use `pnpm dev:agent` for any required browser smoke and stop it when finished.

## Risks

- Chat identity checks before the first `await` are not enough. The active chat
  must be checked after hydration and immediately before mutation.
- Generation jobs may be valid even when the UI moved away. Freshness checks
  should target the persisted chat/message rows, not only current selection.
