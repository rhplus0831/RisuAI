import type { Database, character } from '../../../../src/ts/storage/database.svelte'
import type { CbsCallbackMemo } from '../../../../src/ts/cbs'
import type { LLMModel } from '../../../../src/ts/model/types'
import type { CbsConditions } from '../../../../src/ts/parser/risuChatParserHelpers'
import type { LuaExecBudget } from './luaRuntime.js'
import type { DatabaseSync } from 'node:sqlite'
import { risuChatParser } from '../../../../src/ts/parser/risuChatParser'
import { clearActivePromptScope, isActivePromptScopeDirty, setActivePromptScope } from './promptScope.js'
import { AgentPresetGenerationError } from './agentPresetErrors.js'
import { expandAgentPresetOutputCbs } from '../../../../src/ts/agentPresetReferences'

/**
 * Server-side `risuChatParser` entry point.
 *
 * Sets the active prompt scope from `ctx.database` + selected character
 * + chat indices, runs the canonical browser parser (extracted to a
 * Svelte-free module), then clears the scope. The chat's
 * `scriptstate` object is mutated in place when `runVar` is true and
 * the preset contains `{{setvar}}` / `{{addvar}}` / `{{setdefaultvar}}`;
 * the caller can check `expandVariables.returns.dirty` to decide
 * whether to persist `ctx.database` via `applyImport`.
 *
 * Browser-context cbs callbacks (`{{screenwidth}}`,
 * `{{metadata::browserlanguage}}`) register but will throw at invocation on the
 * server.
 *
 * `bootPromptVariables()` must have been called before the first
 * `expandVariables` invocation; the boot wires the chatVar backend and
 * registers the cbs callbacks into the parser's matcherMap.
 */

export interface ExpandContext {
  database: Database
  /** Current chat-message index for CBS callbacks such as `{{chat_index}}`. */
  chatID?: number
  /** Index into `database.characters`. Defaults to `database.currentChar ?? 0`. */
  selectedCharID?: number
  /**
   * Index into `database.characters[selectedCharID].chats`. Defaults to
   * the character's stored `chatPage` (the active chat).
   */
  chatPage?: number
  /**
   * Enables `{{setvar}}` / `{{addvar}}` / `{{setdefaultvar}}` mutation.
   * Defaults to false so preview / read-only assembly paths can't
   * accidentally write chat state.
   */
  runVar?: boolean
  /** Per-call slot map; consumed by `{{slot::X}}`. */
  slot?: Record<string, string>
  /** Named Agent Preset outputs consumed by `{{agent::key}}` in the current expansion stage. */
  agentOutputs?: Record<string, string>
  /** Whether a named Agent Preset output is allowed to disappear. */
  agentOutputRequired?: Record<string, boolean>
  /** Optional chat role passed into the matcher arg (`{{role}}`). */
  role?: string
  /** Conditional flags for `{{#when::isfirstmsg}}` etc. */
  cbsConditions?: CbsConditions
  /** Optional explicit character override; defaults to the resolved character from the db. */
  chara?: string | character
  /** Recursion guard for direct callers; defaults to the parser's own. */
  callStack?: number
  /** Originating request/durable-job abort signal for downstream trigger handoffs. */
  signal?: AbortSignal
  /** Optional per-assembly Lua budget shared by trigger handoffs from prompt helpers. */
  luaExecBudget?: LuaExecBudget
  /** Server-only SQLite handle for Lua LLM diagnostics/generated-inlay metadata. */
  requestHistoryDb?: DatabaseSync
  /** Server-only asset root for Lua-generated inlays. */
  assetDataDir?: string
  /** Optional per-assembly CBS callback memo. Browser/local calls omit this. */
  cbsCallbackMemo?: CbsCallbackMemo
  /** Effective main-request model metadata exposed through CBS `metadata`. */
  modelInfo?: LLMModel
}

export interface ExpandResult {
  /** The expanded string. */
  text: string
  /** True if any chat-var mutation happened during expansion. */
  dirty: boolean
}

export function expandVariables(input: string, ctx: ExpandContext): ExpandResult {
  const currentCharIndex = (ctx.database as { currentChar?: unknown }).currentChar
  const selectedCharID = ctx.selectedCharID ?? (typeof currentCharIndex === 'number' ? currentCharIndex : 0)
  const char = ctx.database.characters[selectedCharID]
  const chatPage = ctx.chatPage ?? char?.chatPage ?? 0
  const chat = char?.chats?.[chatPage]

  if (chat && !chat.scriptstate) {
    // Lazy-init mirrors `chatVar.svelte.ts` (browser behavior).
    chat.scriptstate = {}
  }

  const scriptstate = (chat?.scriptstate ?? {}) as Record<string, unknown>
  const globalChatVariables = (ctx.database.globalChatVariables ?? {}) as Record<string, unknown>

  setActivePromptScope({
    database: ctx.database,
    selectedCharID,
    chatPage,
    scriptstate,
    globalChatVariables,
    modelInfo: ctx.modelInfo,
  })

  try {
    const text = risuChatParser(expandAgentPresetOutputs(input, ctx), {
      chatID: ctx.chatID,
      db: ctx.database,
      chara: ctx.chara ?? char,
      var: ctx.slot,
      runVar: ctx.runVar ?? false,
      role: ctx.role,
      cbsConditions: ctx.cbsConditions,
      callStack: ctx.callStack,
      callbackMemo: ctx.cbsCallbackMemo,
    })
    return { text, dirty: isActivePromptScopeDirty() }
  } finally {
    clearActivePromptScope()
  }
}

function expandAgentPresetOutputs(input: string, ctx: ExpandContext): string {
  return expandAgentPresetOutputCbs(input, (key) => {
    const value = ctx.agentOutputs?.[key]
    if (typeof value === 'string') return value
    if (ctx.agentOutputRequired?.[key]) {
      throw new AgentPresetGenerationError(`Required Agent Preset output is missing: ${key}`, {
        outputKey: key,
      })
    }
    return ''
  })
}
