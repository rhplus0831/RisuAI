import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { ChatVarBackend } from '../../../../src/ts/parser/chatVarBackend'

/**
 * Request-local prompt scope used by CBS callbacks to read and mutate chat
 * variables during prompt expansion.
 */

export interface PromptScope {
  database: Database
  selectedCharID: number
  chatPage: number
  scriptstate: Record<string, unknown>
  globalChatVariables: Record<string, unknown>
}

let activeScope: PromptScope | null = null
let dirty = false

export function setActivePromptScope(scope: PromptScope): void {
  activeScope = scope
  dirty = false
}

export function clearActivePromptScope(): void {
  activeScope = null
  dirty = false
}

export function isActivePromptScopeDirty(): boolean {
  return dirty
}

export function getActiveDatabase(): Database | null {
  return activeScope?.database ?? null
}

export function getActiveSelectedCharID(): number {
  return activeScope?.selectedCharID ?? 0
}

export const chatVarBackend: ChatVarBackend = {
  getChatVar(key: string): string {
    if (!activeScope) return 'null'
    const stored = activeScope.scriptstate['$' + key]
    if (stored === undefined || stored === null) return 'null'
    return String(stored)
  },
  setChatVar(key: string, value: string): void {
    if (!activeScope) return
    activeScope.scriptstate['$' + key] = value
    dirty = true
  },
  getGlobalChatVar(key: string): string {
    if (!activeScope) return 'null'
    const stored = activeScope.globalChatVariables[key]
    if (stored === undefined || stored === null) return 'null'
    return String(stored)
  },
}
