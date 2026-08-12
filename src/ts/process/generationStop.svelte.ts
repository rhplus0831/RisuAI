import { get, writable } from 'svelte/store'
import { captureActiveChatTarget } from '../chatCommands'
import { findGenerationOperationIdForTarget, stopGenerationOperation } from '../server/generationOperations'
import { findChatGenerationActivity } from './generationActivity.svelte'
import { abortInputHookActivity } from './inputHookActivity.svelte'

export const abortChat = writable(false)

/**
 * Route an explicit composer Stop to the exact protocol operation whenever one
 * owns the active chat. The generation viewer remains attached through the
 * canonical cancelled terminal so its persisted snapshot can be reconciled.
 */
export function abortActiveGeneration(): void {
  abortChat.set(true)
  const target = captureActiveChatTarget()
  const activity = findChatGenerationActivity(target)
  const operationId = activity?.operationId ?? findGenerationOperationIdForTarget(target)
  if (operationId) {
    void stopGenerationOperation(operationId)
    return
  }
  if (activity?.controller) {
    activity.controller.abort()
    return
  }

  if (abortInputHookActivity(target)) return

  // A bootstrap-discovered durable job can be visible for a brief moment before
  // its reattach controller is installed. Let Stop cancel that exact chat too.
  if (target?.chatId) {
    void import('./reattach').then(({ activeGenerationJobs }) => {
      const job = get(activeGenerationJobs).find((candidate) => candidate.chatId === target.chatId)
      if (!job) return
      if (job.operationId) {
        void stopGenerationOperation(job.operationId)
        return
      }
      void import('./request/serverChat').then(({ cancelServerChatGeneration }) =>
        cancelServerChatGeneration(job.jobId),
      )
    })
  }
}
