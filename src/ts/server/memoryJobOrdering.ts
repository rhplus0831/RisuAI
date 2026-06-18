import type { ServerMemoryJob } from '../process/request/serverMemory'

type MemoryJobOrderingTarget = Pick<ServerMemoryJob, 'chatId' | 'id' | 'status'>

const terminalJobIdsByChatId = new Map<string, Set<string>>()

export function isTerminalMemoryJobStatus(status: ServerMemoryJob['status']): boolean {
  return status === 'cancelled' || status === 'completed' || status === 'failed'
}

export function recordTerminalMemoryJobUpdate(job: MemoryJobOrderingTarget): void {
  if (!isTerminalMemoryJobStatus(job.status)) return

  let terminalJobIds = terminalJobIdsByChatId.get(job.chatId)
  if (!terminalJobIds) {
    terminalJobIds = new Set()
    terminalJobIdsByChatId.set(job.chatId, terminalJobIds)
  }
  terminalJobIds.add(job.id)
}

export function shouldAcceptMemoryJobUpdate(job: MemoryJobOrderingTarget): boolean {
  if (isTerminalMemoryJobStatus(job.status)) {
    recordTerminalMemoryJobUpdate(job)
    return true
  }

  return !terminalJobIdsByChatId.get(job.chatId)?.has(job.id)
}

export function clearMemoryJobTerminalUpdateFence(): void {
  terminalJobIdsByChatId.clear()
}
