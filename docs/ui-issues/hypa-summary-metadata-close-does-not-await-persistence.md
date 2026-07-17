# Hypa summary metadata edits can outlive the modal without acknowledgement

- **Severity:** High
- **Affected surfaces:** `HYPA-01` (modal load/close lifecycle), `HYPA-03` (summary-row Important/category controls), and `HYPA-05` (tag manager)
- **Primary locations:** `src/lib/Others/HypaV3Modal.svelte:219-265,567-607`; `src/lib/Others/HypaV3Modal/modal-summary-item.svelte:288-290,596-603`; `src/lib/Others/HypaV3Modal/tag-manager-modal.svelte:34-76`

## Trigger

1. In the server-backed Hypa V3 modal, change a summary's Important flag, category, or tags.
2. Close the modal before the corresponding `PATCH` settles, or let that request fail.

## Expected behavior

Closing should use the same persistence barrier for every editable server-summary field. The modal should remain open, or clearly report a durable queued state, until the mutation is acknowledged. A rejected edit should stay visible with an actionable error instead of disappearing after a later refresh.

## Actual behavior

Important, category, and tag controls optimistically mutate `serverHypaV3Data` and explicitly discard the Promise returned by `onSummaryChanged` (`src/lib/Others/HypaV3Modal/modal-summary-item.svelte:288-290,600-603`; `src/lib/Others/HypaV3Modal/tag-manager-modal.svelte:43-55,63-76`).

The parent does queue and classify each `PATCH`, but only text mutations are registered in `pendingServerSummaryTextSaves` and `dirtyServerSummaryTextVersions` (`src/lib/Others/HypaV3Modal.svelte:219-233,236-264`). `requestModalClose` checks only the text-dirty map; when it is empty, it closes synchronously even if a metadata mutation is still in `serverSummaryMutationQueues` (`src/lib/Others/HypaV3Modal.svelte:567-607`). `App.svelte` then unmounts the component (`src/App.svelte:321-323`).

If the request fails after unmount, `serverMemoryError` is written only into the destroyed component and the user never sees it. Reopening lists the authoritative older value, which looks like a silent reversion. If a quick reopen's list request wins the race against the older `PATCH`, the new modal can instead display the old value after the server has successfully persisted the edit; the acknowledgement updates only the old component instance, and the direct memory route emits no revisioned resource event for the new instance.

## Underlying cause

The modal has a complete per-summary mutation queue, but its close barrier was implemented as a text-only special case. Metadata controls are fire-and-forget callers, and ownership of the queue/error/reconciliation state is local to the component instance rather than a chat-scoped memory-summary resource owner.

## Affected data flow

1. A control changes `summary.isImportant`, `summary.categoryId`, or `summary.tags` in `serverHypaV3Data`.
2. `handleServerSummaryChanged` builds a field patch and `queueServerSummaryMutation` serializes it by summary ID (`src/lib/Others/HypaV3Modal.svelte:195-264`).
3. `patchServerMemorySummary` sends `PATCH /api/v1/memory/summaries/:summaryId` with `Prefer: return=minimal` (`src/ts/process/request/serverMemory.ts:266-280`).
4. Fastify validates the field, merges metadata, calls `updateMemorySummary`, and returns only `{ summaryId }` for the minimal response (`server/fastify/src/routes/memoryReads.ts:78-164`). SQLite persistence occurs in `server/fastify/src/memoryRepository.ts:618-648`.
5. On success, the mounted parent marks its local edit acknowledged. On failure, it records a local error and schedules a list refresh after its queue drains (`src/lib/Others/HypaV3Modal.svelte:246-263`).
6. Closing unmounts that acknowledgement owner without waiting for metadata queues. There is no mounted UI left to display its error or apply its reconciliation, and a newly mounted modal owns an independent GET/projection lifecycle.

## User impact

Important markers, category assignments, and tags can apparently save and then revert with no error. In the successful race variant, the server contains the new value while the currently open modal continues to show the old one. These fields are used to organize and select memory, so stale metadata can also change what the user believes will be recalled.

## Recommended fix

- Track pending saves for every summary field, not only text, and have `requestModalClose` await all queues associated with the current chat.
- Keep the modal open and render the existing error if any terminal mutation fails; show an explicit queued state if retryable memory writes gain durable staging.
- Add per-summary pending state so metadata controls cannot issue ambiguous overlapping actions while a close is requested.
- Fence acknowledgements and errors by `{ chatId, component/owner epoch }`.
- Prefer moving memory-summary projection and mutation ownership outside the modal, or emit/apply a chat-scoped summary invalidation so a rapid reopen cannot miss a successful older mutation.
- Extend the close-reliability tests, which currently cover dirty text (`src/lib/Others/HypaV3Modal.serverReliability.test.ts:148-188`), with deferred Important/category/tag patches and a close/reopen race.
