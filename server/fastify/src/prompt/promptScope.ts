import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { ChatVarBackend } from '../../../../src/ts/parser/chatVarBackend'
import type { LLMModel } from '../../../../src/ts/model/types'
import { resolveModelProfile, type ResolvedModelProfile } from '../../../../src/ts/model/modelProfileResolver'
import { getChatDefaultVariables, readChatVariable } from './chatVarDefaults.js'
import type { ReportedClientContext } from '../../../../src/ts/process/request/clientContext.js'

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
  /** Effective main-request model metadata for CBS `{{metadata::model*}}`. */
  modelInfo?: LLMModel
  /** Browser values reported with the generation request. */
  clientContext?: ReportedClientContext
  /** Request-wide CBS diagnostics collector shared across parser expansions. */
  cbsCallbackDiagnostics?: Map<string, ServerCbsCallbackDiagnosticReason>
}

export type ServerCbsCallbackDiagnosticReason = 'unsupported_on_server' | 'client_context_unavailable'

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

export function getActiveChatPage(): number {
  return activeScope?.chatPage ?? 0
}

export function getActiveClientContext(): ReportedClientContext | undefined {
  return activeScope?.clientContext
}

export function reportActiveCbsCallbackDiagnostic(
  callbackName: string,
  reason: ServerCbsCallbackDiagnosticReason,
): void {
  if (!activeScope?.cbsCallbackDiagnostics?.has(callbackName)) {
    activeScope?.cbsCallbackDiagnostics?.set(callbackName, reason)
  }
}

export function modelInfoForPromptScope(profile: ResolvedModelProfile): LLMModel {
  return {
    ...profile.modelInfo,
    // Durable/custom profiles keep their actual wire model separately from the
    // catalog row. CBS `modelinternalid` should describe the effective request.
    internalID: profile.requestModel || profile.modelInfo.internalID || profile.modelInfo.id,
  }
}

export function getActiveModelInfo(): LLMModel {
  if (!activeScope) {
    throw new Error('promptScope not set; call setActivePromptScope before expandVariables')
  }
  activeScope.modelInfo ??= modelInfoForPromptScope(resolveModelProfile({ database: activeScope.database }))
  return activeScope.modelInfo
}

export const chatVarBackend: ChatVarBackend = {
  getChatVar(key: string): string {
    if (!activeScope) return 'null'
    const currentChar = activeScope.database.characters[activeScope.selectedCharID]
    if (!currentChar) return 'null'
    return (
      readChatVariable(activeScope.scriptstate, key, getChatDefaultVariables(currentChar, activeScope.database)) ??
      'null'
    )
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
