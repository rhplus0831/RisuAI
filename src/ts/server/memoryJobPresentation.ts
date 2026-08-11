import type { ServerMemoryJob } from '../process/request/serverMemory'

export interface MemoryProgressGroup {
  chatId: string
  label: string
  jobs: ServerMemoryJob[]
}

export function groupMemoryJobsForPresentation(
  jobs: readonly ServerMemoryJob[],
  prioritizedChatId: string | null,
  labelForChat: (chatId: string) => string,
): MemoryProgressGroup[] {
  const grouped = new Map<string, ServerMemoryJob[]>()
  for (const job of jobs) {
    const current = grouped.get(job.chatId) ?? []
    current.push(job)
    grouped.set(job.chatId, current)
  }
  return [...grouped.entries()]
    .map(([chatId, groupedJobs]) => ({ chatId, label: labelForChat(chatId), jobs: groupedJobs }))
    .sort((left, right) => {
      if (left.chatId === prioritizedChatId) return -1
      if (right.chatId === prioritizedChatId) return 1
      return left.label.localeCompare(right.label)
    })
}
