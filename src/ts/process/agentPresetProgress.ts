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

export const agentPresetProgress = writable<ActiveAgentPresetProgress | null>(null)

let activeSession: AgentPresetProgressSession | null = null

export function beginAgentPresetProgress(chatId: string): AgentPresetProgressSession {
  const session = { chatId }
  activeSession = session
  agentPresetProgress.set(null)
  return session
}

export function clearAgentPresetProgress(session?: AgentPresetProgressSession): void {
  if (session && activeSession !== session) return
  activeSession = null
  agentPresetProgress.set(null)
}

export function updateAgentPresetProgress(session: AgentPresetProgressSession, event: AgentPresetProgressEvent): void {
  if (activeSession !== session || event.chatId !== session.chatId) return
  if (TERMINAL_PROGRESS_STATUSES.has(event.status)) {
    agentPresetProgress.update((current) => {
      const samePhase =
        current?.chatId === event.chatId && current.presetId === event.presetId && current.phase === event.phase
      return samePhase ? null : current
    })
    return
  }

  const now = Date.now()
  const { type: _type, ...progress } = event
  void _type
  agentPresetProgress.update((current) => {
    const samePhase =
      current?.chatId === event.chatId && current.presetId === event.presetId && current.phase === event.phase
    return {
      ...progress,
      startedAt: samePhase ? current.startedAt : now,
      updatedAt: now,
    }
  })
}

export function getAgentPresetProgressPercent(progress: { completedSteps: number; totalSteps: number }): number {
  const totalSteps = Math.max(0, Math.floor(Number(progress.totalSteps) || 0))
  if (totalSteps === 0) return 0
  const completedSteps = Math.max(0, Math.min(totalSteps, Math.floor(Number(progress.completedSteps) || 0)))
  return Math.round((completedSteps / totalSteps) * 100)
}
