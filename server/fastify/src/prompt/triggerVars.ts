import type { Chat, Database } from '../../../../src/ts/storage/database.svelte'
import { readChatVariable } from './chatVarDefaults.js'

/**
 * Trigger variable engine, ported from the closures inside
 * `src/ts/process/triggers.ts` `runTrigger`.
 *
 * The SPA defines `getVar` / `setVar` and the local-variable scope
 * helpers as closures over `runTrigger`'s mutable state. The server
 * extracts them into this factory so they are unit-testable on their
 * own and so `triggers.ts` stays focused on effect dispatch.
 *
 * Resolution order for `getVar`:
 *   1. the local-variable scope stack,
 *   2. the working chat's `scriptstate['$' + key]`,
 *   3. `defaultVariables` (char + template defaults),
 *   4. in `displayMode`, `tempVars[key]`,
 *   5. `'null'`.
 *
 * `setVar`:
 *   - `displayMode` writes land in `tempVars` only,
 *   - a write to an existing local var stays local at the current
 *     indent,
 *   - otherwise the value is written to the working chat's
 *     `scriptstate`, `varChanged` is flipped, and the scriptstate
 *     object is propagated onto the persisted
 *     `database.characters[selectedCharID].chats[chatPage]`.
 *
 * Divergence from the SPA: the SPA keeps three separate stores
 * (`getCurrentChat()`, `getCurrentCharacter()`, `getDatabase()`) in
 * sync and bumps `ReloadGUIPointer`. On the server `currentChat` /
 * `currentCharacter` alias the single `database` snapshot, so one
 * scriptstate assignment is enough; GUI reload is browser-only and is
 * dropped. The caller reads `varChanged` to decide whether to persist
 * the database.
 */

export interface TriggerVarEngineOptions {
  /** The working (cloned) chat the trigger run mutates. */
  chat: Chat
  /** Active database snapshot `setVar` persists into. */
  database: Database
  /** Index into `database.characters`. */
  selectedCharID: number
  /** Index into the selected character's `chats`. */
  chatPage: number
  /** Char + template `[key, value]` default-variable pairs. */
  defaultVariables: [string, string][]
  /** `display` / `displayMode` runs keep var writes in `tempVars`. */
  displayMode?: boolean
  /** Per-run temp vars, mutated in place in `displayMode`. */
  tempVars?: Record<string, string>
}

export interface TriggerVarEngine {
  getVar(key: string): string
  setVar(key: string, value: string): boolean
  declareLocalVar(key: string, value: string, indent: number): void
  setLocalVar(key: string, value: string, indent: number): boolean
  clearLocalVarsAtIndent(indent: number): void
  /** Sets the effect loop's current indent (drives local-scope writes). */
  setIndent(indent: number): void
  /**
   * Repoints the engine after `runtrigger` recursion so later `setVar`s in the
   * same effect list write to the latest chat clone.
   */
  setChat(next: Chat): void
  /** True once a non-local, non-display `setVar` wrote chat state. */
  readonly varChanged: boolean
}

export function createTriggerVarEngine(opts: TriggerVarEngineOptions): TriggerVarEngine {
  const { database, selectedCharID, chatPage, defaultVariables } = opts
  let chat = opts.chat
  const displayMode = opts.displayMode ?? false
  const tempVars = opts.tempVars ?? {}

  let localVarScopes: Record<number, Record<string, string>>[] = [{}]
  let currentIndent = 0
  let varChanged = false

  function getLocalVar(key: string): string | null {
    if (!localVarScopes || localVarScopes.length === 0) {
      return null
    }
    const currentScope = localVarScopes[localVarScopes.length - 1]
    if (!currentScope) {
      return null
    }
    for (let indent = currentIndent; indent >= 0; indent--) {
      if (currentScope[indent] && currentScope[indent][key] !== undefined) {
        return currentScope[indent][key]
      }
    }
    return null
  }

  function setLocalVar(key: string, value: string, indent: number): boolean {
    if (!localVarScopes || localVarScopes.length === 0) {
      localVarScopes = [{}]
    }
    const currentScope = localVarScopes[localVarScopes.length - 1]
    if (!currentScope) {
      return false
    }

    const finalValue = value === null || value === undefined ? 'null' : value

    let foundIndent = -1
    for (let i = indent; i >= 0; i--) {
      if (currentScope[i] && currentScope[i][key] !== undefined) {
        foundIndent = i
        break
      }
    }

    const targetIndent = foundIndent !== -1 ? foundIndent : indent

    if (!currentScope[targetIndent]) {
      currentScope[targetIndent] = {}
    }

    if (currentScope[targetIndent][key] === finalValue) {
      return false
    }

    currentScope[targetIndent][key] = finalValue
    return true
  }

  function declareLocalVar(key: string, value: string, indent: number): void {
    setLocalVar(key, value, indent)
  }

  function clearLocalVarsAtIndent(indent: number): void {
    if (!localVarScopes || localVarScopes.length === 0) {
      return
    }
    const currentScope = localVarScopes[localVarScopes.length - 1]
    if (!currentScope) {
      return
    }
    const indentsToDelete: string[] = []
    for (const scopeIndent in currentScope) {
      if (Number(scopeIndent) >= indent) {
        indentsToDelete.push(scopeIndent)
      }
    }
    indentsToDelete.forEach((indentKey) => {
      delete currentScope[Number(indentKey)]
    })
  }

  function getVar(key: string): string {
    const localVar = getLocalVar(key)
    if (localVar !== null) {
      return localVar
    }

    const resolved = readChatVariable(chat.scriptstate as Record<string, unknown> | undefined, key, defaultVariables)
    if (resolved !== undefined) return resolved
    if (displayMode) {
      return tempVars[key] ?? 'null'
    }
    return 'null'
  }

  function setVar(key: string, value: string): boolean {
    if (displayMode) {
      if (tempVars[key] === value) {
        return false
      }
      tempVars[key] = value
      return true
    }

    const localVar = getLocalVar(key)
    if (localVar !== null) {
      return setLocalVar(key, value, currentIndent)
    }

    chat.scriptstate ??= {}
    const stateKey = '$' + key
    if (chat.scriptstate[stateKey] === value) {
      return false
    }

    varChanged = true
    chat.scriptstate[stateKey] = value
    const dbChat = database.characters?.[selectedCharID]?.chats?.[chatPage]
    if (dbChat) {
      dbChat.scriptstate = chat.scriptstate
    }
    return true
  }

  return {
    getVar,
    setVar,
    declareLocalVar,
    setLocalVar,
    clearLocalVarsAtIndent,
    setIndent(indent: number): void {
      currentIndent = indent
    },
    setChat(next: Chat): void {
      chat = next
    },
    get varChanged(): boolean {
      return varChanged
    },
  }
}
