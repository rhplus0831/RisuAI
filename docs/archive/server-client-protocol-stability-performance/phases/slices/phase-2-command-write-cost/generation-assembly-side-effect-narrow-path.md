# Generation Assembly Side-Effect Narrow Path

Status: implemented on 2026-06-01.

## Source Anchors

- `server/fastify/src/routes/generationChat.ts`
- `server/fastify/src/commands/mutations.ts`
- `server/fastify/src/messageStore.ts`
- `server/fastify/src/repository.ts`
- `server/fastify/__tests__/generation.chat.test.ts`

## Scope

Reduce the hydrated command mutation cost for eligible prompt-assembly
side-effect persistence selected by
[`generation-prompt-metric-review.md`](generation-prompt-metric-review.md).

Implemented runtime batch:

- Added a narrow assembly side-effect persistence path used by
  `persistAssemblyMutations()` when the assembly delta is limited to:
  chat `scriptstate` writes/deletes, post-`editinput` transcript replacement,
  or both.
- Avoided loading and cloning every hydrated chat in the generic
  `applyJsonCommandMutation` path for those eligible deltas.
- Preserved the existing "nothing to persist" skip behavior for plain sends and
  kept preview/preview-prompt paths read-only.
- Repaired route-owned transcript rows that arrive without `chatId` before
  validation, preserving the old hydrated sync behavior for Lua-added messages.

## Durable Mutation Behavior

- Read message-free `db.json` to validate the target chat and apply
  `scriptstate` metadata changes.
- Replace only the target chat's SQLite messages when
  `submitTranscriptChanged` is true.
- Write message-free `db.json` only when projected chat metadata changes.
- Keep all SQLite message writes, revision bumps, and command-event persistence
  inside one `BEGIN IMMEDIATE` transaction.

## Event Behavior

- Preserve existing event shapes:
  - `chat.scriptstate.updated` for chat-var-only assembly deltas.
  - `messages.replaced` when the route owns a post-input-trigger or
    post-`editinput` transcript rewrite.
- Preserve exactly one revision bump and exactly one replayable command event
  for each committed projected mutation.
- Preserve the SSE `info.revision` behavior that lets the browser reconcile its
  cached command revision.

## Rollback And Resync Behavior

- Stale revisions, missing chats, invalid transcript rows, duplicate message
  ids, and event persistence failures must roll back message rows, metadata
  changes, revision bumps, and command-event rows before any live event emits.
- `db.json` must not land ahead of the SQLite rows, revision bump, and command
  event it depends on.
- Clients continue to reconcile through the existing command-event stream or
  full-bootstrap fallback on gaps.

## Implemented Result

- Eligible assembly side effects now use `applyTargetedCommandMutation` with
  `mutationPath: "targeted-assembly"`.
- Chat-var-only deltas write message-free `db.json` after the SQLite commit and
  emit unchanged `chat.scriptstate.updated` events.
- Transcript rewrites replace only the target chat's active SQLite messages and
  emit unchanged `messages.replaced` events.
- Combined transcript-plus-chat-var deltas perform both target writes in one
  transaction and write message-free `db.json` after commit.
- Plain sends and durable sends with no assembly side effect still skip assembly
  persistence.

## Proof Commands

- Passed:
  `RISU_PROTOCOL_METRICS=1 pnpm api:test -- server/fastify/__tests__/generation.chat.test.ts server/fastify/__tests__/durableGeneration.test.ts`
- Passed:
  `RISU_COMMAND_METRIC_SUMMARY=1 pnpm api:test __tests__/commandMetrics.test.ts --reporter verbose`
- Passed: `pnpm client-thinning:audit`

## Done When

- Chat-var and transcript-rewrite assembly side effects no longer report
  `mutationPath: "hydrated"` in the representative metric review.
- `messages.replaced` and `chat.scriptstate.updated` revision/event behavior is
  unchanged.
- Focused generation tests prove plain sends, preview prompts, durable
  generation, and final generation persistence keep their existing contracts.
