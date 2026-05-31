# Generation Reattach Triggers

Status: planned.

## Source Anchors

- `src/ts/process/reattach.ts`
- `src/ts/bootstrap.ts`
- `src/ts/process/request/serverChat.ts`
- `server/fastify/src/generationJobs.ts`

## Scope

Run the reattach probe when the active chat changes and after full resync updates
`activeGenerationJobs`, not only when character selection changes.

## Protocol Behavior

- Preserve one running generation per chat.
- Do not steal active-writer ownership during read-only full resync.
- Avoid duplicate attachments for the same job id.

## Done When

- Switching chats within the same character can discover a matching active job.
- Full bootstrap resync that updates active jobs can trigger reattach.
- Existing cancel/status behavior remains unchanged.

## Validation

- `pnpm test -- src/ts/bootstrap.test.ts`
- `pnpm test -- src/ts/process/request/tests/durableGeneration.test.ts`
