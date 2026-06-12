# Generation Reattach Triggers

Status: implemented.

## Source Anchors

- `src/ts/process/reattach.ts`
- `src/ts/bootstrap.ts`
- `src/ts/server/projectionResync.ts`
- `src/ts/process/request/serverChat.ts`
- `server/fastify/src/generationJobs.ts`

## Scope

Run the reattach probe when the active chat changes and after full resync updates
`activeGenerationJobs`, not only when character selection changes.

## Implemented

- `src/ts/process/reattach.ts` now exposes a queued
  `triggerOpenChatGenerationReattach()` probe so multiple projection changes in
  the same tick coalesce behind the existing single-reattach guard.
- Targeted `characters` projection merges call the queued probe after chat
  hydration/lorebook reset work, so selecting another chat inside the same
  character can discover a matching active job.
- Full bootstrap resync calls the queued probe after applying the projection and
  refreshing `activeGenerationJobs`, including backup-restore resyncs.
- The existing reattach path still consumes each matching `jobId` before
  streaming and skips attachment while `doingChat` is true.

## Protocol Behavior

- Preserve one running generation per chat.
- Do not steal active-writer ownership during read-only full resync.
- Avoid duplicate attachments for the same job id.

## Done When

- Switching chats within the same character can discover a matching active job.
- Full bootstrap resync that updates active jobs can trigger reattach.
- Existing cancel/status behavior remains unchanged.

## Validation

- Passed:
  `pnpm test -- src/ts/process/__tests__/reattach.test.ts src/ts/bootstrap.test.ts src/ts/server/backups.test.ts`
- `pnpm test -- src/ts/process/request/tests/durableGeneration.test.ts`
