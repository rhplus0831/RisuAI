import { CCardLib } from '@risuai/ccardlib'
import type {
  Chat,
  Database,
  character,
  loreBook,
} from '../../../../src/ts/storage/database.svelte'
import { getActiveModules } from './modules.js'

/**
 * Phase 7-7a lorebook activation: constant (always-on) entries only.
 *
 * Ports the always-on slice of
 * `src/ts/process/lorebook.svelte.ts:loadLoreBookV3Prompt` into a
 * Svelte-free, request-scoped function. The decorator parser scaffold
 * established here is reused by the next slices in the chain:
 *
 *   - 7-7b: keyword matching activation (`additional_keys`,
 *     `exclude_keys*`, `match_*_word`, `useRegex`, `secondkey`).
 *   - 7-7c: recursion (`recursive`, `unrecursive`,
 *     `no_recursive_search`).
 *   - 7-7d: token-budget truncation (requires `tokens` from 7-8).
 *   - 7-7e: depth-prompt emission into history.
 *
 * In-scope decorators (parsed, applied, and stripped from prompt text):
 *   - `role`, `position`, `depth`/`reverse_depth`, `end`
 *   - `priority`, `ignore_on_max_context`
 *   - `inject_lore`, `inject_at`, `inject_replace`, `inject_prepend`
 *   - `disable_ui_prompt`
 *
 * Every other decorator hits `default: return false` (same as the SPA
 * for unknown decorators), so its `@@` line stays in the prompt text
 * verbatim until its sub-slice lands. This keeps round-trip behavior
 * stable for early consumers and lets the keyword/recursion slices
 * flip individual cases without churn here.
 */

export interface LoreInject {
  operation: 'append' | 'prepend' | 'replace'
  location: string
  param: string
  lore: boolean
}

export type LorePosition =
  | ''
  | 'depth'
  | 'reverse_depth'
  | 'after_desc'
  | 'before_desc'
  | 'personality'
  | 'scenario'
  | `pt_${string}`

export interface LoreEntryActive {
  depth: number
  pos: LorePosition
  prompt: string
  role: 'system' | 'user' | 'assistant'
  order: number
  priority: number
  source: string
  inject: LoreInject | null
}

export interface LorebookActivationReport {
  actives: LoreEntryActive[]
  disabledUIPrompts: string[]
  /**
   * Keyword-search audit log. Empty in 7-7a; populated by 7-7b/c so
   * `prompt`-stage SSE consumers can render the activation reason
   * tree later.
   */
  matchLog: Array<{ prompt: string; source: string; activated: string }>
}

export interface ActivateLorebookInput {
  database: Database
  currentChar: character
  currentChat: Chat
}

const POSITION_NAMED = new Set([
  'after_desc',
  'before_desc',
  'personality',
  'scenario',
])

function collectEntries(input: ActivateLorebookInput): loreBook[] {
  const { database, currentChar, currentChat } = input
  const characterLore = currentChar.globalLore ?? []
  const chatLore = currentChat.localLore ?? []
  const moduleLore = getActiveModules(database, currentChar, currentChat).flatMap(
    (m) => m.lorebook ?? [],
  )
  return [...characterLore, ...chatLore, ...moduleLore]
}

export function activateLorebook(
  input: ActivateLorebookInput,
): LorebookActivationReport {
  const entries = collectEntries(input)
  const actives: LoreEntryActive[] = []
  const disabledUIPrompts: string[] = []

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (!entry) continue
    if (entry.mode === 'folder') continue
    // `child` mode mirrors a previous entry; the mirror-resolve path is
    // tied to the keyword/recursion loop. Defer to 7-7b along with the
    // rest of the conditional-activation surface.
    if (entry.mode === 'child') continue
    if (!entry.alwaysActive) continue

    let pos: LorePosition = ''
    let depth = 0
    let role: 'system' | 'user' | 'assistant' = 'system'
    let order = entry.insertorder
    let priority = entry.insertorder
    let inject: LoreInject | null = null

    const stripped = CCardLib.decorator.parse(entry.content, (name, arg) => {
      switch (name) {
        case 'end': {
          pos = 'depth'
          depth = 0
          return
        }
        case 'depth':
        case 'reverse_depth': {
          const int = parseInt(arg[0])
          if (Number.isNaN(int)) return false
          depth = int
          pos = name === 'depth' ? 'depth' : 'reverse_depth'
          return
        }
        case 'role': {
          if (arg[0] === 'user' || arg[0] === 'assistant' || arg[0] === 'system') {
            role = arg[0]
            return
          }
          return false
        }
        case 'position': {
          const value = arg[0]
          if (value.startsWith('pt_')) {
            pos = value as LorePosition
            return
          }
          if (POSITION_NAMED.has(value)) {
            pos = value as LorePosition
            return
          }
          return false
        }
        case 'inject_lore': {
          inject ??= { operation: 'append', location: '', param: '', lore: true }
          inject.location = arg.join(' ')
          inject.lore = true
          return
        }
        case 'inject_at': {
          inject ??= { operation: 'append', location: '', param: '', lore: false }
          inject.location = arg.join(' ')
          inject.lore = false
          return
        }
        case 'inject_replace': {
          inject ??= { operation: 'replace', location: '', param: '', lore: false }
          inject.operation = 'replace'
          inject.param = arg.join(' ')
          return
        }
        case 'inject_prepend': {
          inject ??= { operation: 'prepend', location: '', param: '', lore: false }
          inject.operation = 'prepend'
          inject.param = arg.join(' ')
          return
        }
        case 'ignore_on_max_context': {
          priority = -1000
          return
        }
        case 'priority': {
          const int = parseInt(arg[0])
          if (Number.isNaN(int)) return false
          priority = int
          return
        }
        case 'disable_ui_prompt': {
          if (arg[0] === 'post_history_instructions' || arg[0] === 'system_prompt') {
            disabledUIPrompts.push(arg[0])
            return
          }
          return false
        }
        default: {
          return false
        }
      }
    })

    actives.push({
      depth,
      pos,
      prompt: stripped,
      role,
      order,
      priority,
      source: entry.comment || `lorebook ${i}`,
      inject,
    })
  }

  // Priority desc (SPA :623). 7-7d will splice in budget-aware
  // truncation between these two sorts.
  actives.sort((a, b) => b.priority - a.priority)
  // Order desc (SPA :637).
  actives.sort((a, b) => b.order - a.order)

  // Apply lore-targeting injections, then drop the injectors from the
  // active list. Mirrors SPA :641-673; cheap and self-contained, so
  // landing it here avoids a re-pass when 7-7d/7-10 wire placement.
  const injectors = actives.filter((a) => a.inject?.lore)
  const survivors = actives.filter((a) => !a.inject?.lore)
  for (const inj of injectors) {
    const target = survivors.find((s) => s.source === inj.inject!.location)
    if (!target) continue
    switch (inj.inject!.operation) {
      case 'append':
        target.prompt += ' ' + inj.prompt
        break
      case 'prepend':
        target.prompt = inj.prompt + ' ' + target.prompt
        break
      case 'replace':
        target.prompt = target.prompt.replace(inj.inject!.param, inj.prompt)
        break
    }
  }

  // Final reverse to match the SPA's return order so downstream
  // template/root slices can append in document order.
  survivors.reverse()

  return {
    actives: survivors,
    disabledUIPrompts,
    matchLog: [],
  }
}
