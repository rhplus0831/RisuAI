import { writable } from 'svelte/store'
import type { AgentPresetProgressEvent } from './request/serverChatEvents'

export type ActiveAgentPresetProgress = Omit<AgentPresetProgressEvent, 'type'> & {
  startedAt: number
  updatedAt: number
}

export interface AgentPresetProgressSession {
  readonly chatId: string
}

const TERMINAL_PROGRESS_STATUSES = new Set<AgentPresetProgressEvent['status']>(['finished', 'error'])
const MAX_ACTIVE_AGENT_PRESET_PROGRESS = 16

export const agentPresetProgress = writable<ActiveAgentPresetProgress[]>([])

const activeSessions = new Map<string, AgentPresetProgressSession>()

function removeProgressForChat(chatId: string): void {
  agentPresetProgress.update((entries) => entries.filter((entry) => entry.chatId !== chatId))
}

function touchSession(session: AgentPresetProgressSession): boolean {
  if (activeSessions.get(session.chatId) !== session) return false
  activeSessions.delete(session.chatId)
  activeSessions.set(session.chatId, session)
  return true
}

function trimActiveSessions(): void {
  while (activeSessions.size > MAX_ACTIVE_AGENT_PRESET_PROGRESS) {
    const oldestChatId = activeSessions.keys().next().value
    if (oldestChatId === undefined) return
    activeSessions.delete(oldestChatId)
    removeProgressForChat(oldestChatId)
  }
}

export function beginAgentPresetProgress(chatId: string): AgentPresetProgressSession {
  const session = { chatId }
  activeSessions.delete(chatId)
  activeSessions.set(chatId, session)
  removeProgressForChat(chatId)
  trimActiveSessions()
  return session
}

export function clearAgentPresetProgress(session?: AgentPresetProgressSession): void {
  if (!session) {
    activeSessions.clear()
    agentPresetProgress.set([])
    return
  }
  if (activeSessions.get(session.chatId) !== session) return
  activeSessions.delete(session.chatId)
  removeProgressForChat(session.chatId)
}

export function updateAgentPresetProgress(session: AgentPresetProgressSession, event: AgentPresetProgressEvent): void {
  if (event.chatId !== session.chatId || !touchSession(session)) return
  if (TERMINAL_PROGRESS_STATUSES.has(event.status)) {
    agentPresetProgress.update((entries) =>
      entries.filter(
        (entry) => entry.chatId !== event.chatId || entry.presetId !== event.presetId || entry.phase !== event.phase,
      ),
    )
    return
  }

  const now = Date.now()
  const { type: _type, ...progress } = event
  void _type
  agentPresetProgress.update((entries) => {
    const current = entries.find((entry) => entry.chatId === event.chatId)
    const samePhase =
      current?.chatId === event.chatId && current.presetId === event.presetId && current.phase === event.phase
    const next = {
      ...progress,
      startedAt: samePhase ? current.startedAt : now,
      updatedAt: now,
    }
    return [...entries.filter((entry) => entry.chatId !== event.chatId), next]
  })
}

export function getAgentPresetProgressPercent(progress: { completedSteps: number; totalSteps: number }): number {
  const totalSteps = Math.max(0, Math.floor(Number(progress.totalSteps) || 0))
  if (totalSteps === 0) return 0
  const completedSteps = Math.max(0, Math.min(totalSteps, Math.floor(Number(progress.completedSteps) || 0)))
  return Math.round((completedSteps / totalSteps) * 100)
}
