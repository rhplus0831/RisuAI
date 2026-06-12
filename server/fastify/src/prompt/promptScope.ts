import type { Database } from '../../../../src/ts/storage/database.svelte'
import type { ChatVarBackend } from '../../../../src/ts/parser/chatVarBackend'

/**
 * Server-side prompt scope. Module-level singleton, matching the
 * single-user assumption documented in `.archived-docs/fastify/other/plan.md`.
 *
 * Holds pointers into the active request's `Database` snapshot
 * (the `db.json` blob loaded by the route handler) so the CBS callbacks
 * registered via `cbs.ts` can read user / persona / character / chat
 * fields without re-resolving them per call.
 *
 * Chat-var writes mutate `scriptstate['$' + key]` in place and flip
 * `dirty`. The route handler decides whether to persist via
 * `applyImport(db, dataDir, database)` after `expandVariables` returns.
 *
 * Concurrency: matches the SPA's existing race behavior. Two concurrent
 * `expandVariables` calls would interleave their chat-var writes; this
 * is the same risk the SPA's `DBState.db` carries today and is
 * acceptable under the single-user assumption. If concurrent server-driven work
 * arrives, swap this singleton for an `AsyncLocalStorage`-backed scope.
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
