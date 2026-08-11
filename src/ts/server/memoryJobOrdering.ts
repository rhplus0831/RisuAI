import type { ServerMemoryJob } from '../process/request/serverMemory'

type MemoryJobOrderingTarget = Pick<ServerMemoryJob, 'chatId' | 'instanceId' | 'status'>

export const MEMORY_JOB_TERMINAL_FENCE_LIMIT = 500

const terminalJobInstances = new Map<string, true>()

export function isTerminalMemoryJobStatus(status: ServerMemoryJob['status']): boolean {
  return status === 'cancelled' || status === 'completed' || status === 'failed'
}

export function recordTerminalMemoryJobUpdate(job: MemoryJobOrderingTarget): void {
  if (!isTerminalMemoryJobStatus(job.status)) return
  const key = orderingKey(job)
  terminalJobInstances.delete(key)
  terminalJobInstances.set(key, true)
  while (terminalJobInstances.size > MEMORY_JOB_TERMINAL_FENCE_LIMIT) {
    const oldest = terminalJobInstances.keys().next().value
    if (typeof oldest !== 'string') break
    terminalJobInstances.delete(oldest)
  }
}

export function shouldAcceptMemoryJobUpdate(job: MemoryJobOrderingTarget): boolean {
  if (isTerminalMemoryJobStatus(job.status)) {
    recordTerminalMemoryJobUpdate(job)
    return true
  }
  return !terminalJobInstances.has(orderingKey(job))
}

export function clearMemoryJobTerminalUpdateFence(): void {
  terminalJobInstances.clear()
}

function orderingKey(job: Pick<ServerMemoryJob, 'chatId' | 'instanceId'>): string {
  return `${job.chatId}\u0000${job.instanceId}`
}
