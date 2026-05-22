import type {
  Chat,
  Message,
  character,
} from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { expandVariables, type ExpandContext } from './variables.js'

/**
 * Phase 7-5a minimal history walk ported from the SPA's
 * `src/ts/process/promptAssembly/buildHistoryWindow.ts` and
 * `src/ts/process/exampleMessages.ts`.
 *
 * Implements only the deterministic part:
 *   - example messages block
 *   - `[Start a new chat]` marker gated by
 *     `!aiModel.startsWith('novelai') && !promptSettings.trimStartNewChat`
 *   - first message from `firstMessage` / `alternateGreetings[fmIndex]`
 *   - `makeMs` filter for `disabled === true` and `disabled === 'allBefore'`
 *   - per-message role mapping (`'user' -> 'user'`, anything else -> `'assistant'`)
 *
 * Deferred to later 7-5 sub-slices: `processScript` editprocess, `sendName`
 * prefix, `<Thoughts>` extraction, multimodal inlays, `{{asset_prompt::}}`,
 * start trigger / `runTrigger`, tokenizer accumulation, depth-prompt preflight.
 */

export function exampleMessage(
  ctx: ExpandContext,
  char: character,
): OpenAIChat[] {
  const raw = char.exampleMessage ?? ''
  if (raw === '') return []

  const lines = raw.split('\n')
  const collected: OpenAIChat[] = []
  let current: OpenAIChat | null = null

  const flush = () => {
    if (current) collected.push(current)
  }

  for (const line of lines) {
    const trimmed = line.trim()
    const lowered = trimmed.toLocaleLowerCase()

    if (lowered === '<start>') {
      flush()
      collected.push({
        role: 'system',
        content: '[Start a new chat]',
        memo: 'NewChatExample',
      })
      current = null
    } else if (
      lowered.startsWith('{{char}}:') ||
      lowered.startsWith('<bot>:') ||
      lowered.startsWith(`${char.name}:`)
    ) {
      flush()
      current = {
        role: 'assistant',
        content: trimmed.split(':', 2)[1].trimStart(),
        name: 'example_assistant',
      }
    } else if (
      lowered.startsWith('{{user}}:') ||
      lowered.startsWith('<user>:')
    ) {
      flush()
      current = {
        role: 'user',
        content: trimmed.split(':', 2)[1].trimStart(),
        name: 'example_user',
      }
    } else if (current) {
      current.content += '\n' + trimmed
    }
  }
  flush()

  return collected.map((entry) => {
    const expanded: OpenAIChat = {
      role: entry.role,
      content: expandVariables(entry.content, { ...ctx, chara: char }).text,
    }
    if (entry.name !== undefined) expanded.name = entry.name
    if (entry.memo !== undefined) expanded.memo = entry.memo
    return expanded
  })
}

export interface HistoryWindowResult {
  messages: OpenAIChat[]
}

export function buildHistoryWindow(
  ctx: ExpandContext,
  currentChar: character,
  currentChat: Chat,
): HistoryWindowResult {
  const db = ctx.database
  const messages: OpenAIChat[] = []

  messages.push(...exampleMessage(ctx, currentChar))

  const aiModel = db.aiModel ?? ''
  const trimStart = db.promptSettings?.trimStartNewChat ?? false
  if (!aiModel.startsWith('novelai') && !trimStart) {
    messages.push({
      role: 'system',
      content: '[Start a new chat]',
      memo: 'NewChat',
    })
  }

  let msReseted = false
  const ms: Message[] = []
  for (let i = currentChat.message.length - 1; i >= 0; i--) {
    const d = currentChat.message[i]
    if (d.disabled === true) continue
    if (d.disabled === 'allBefore') {
      msReseted = true
      break
    }
    ms.unshift(d)
  }

  if (!msReseted) {
    const fmIndex = currentChat.fmIndex ?? -1
    const firstMsgSource =
      fmIndex === -1
        ? currentChar.firstMessage ?? ''
        : currentChar.alternateGreetings?.[fmIndex] ?? ''
    messages.push({
      role: 'assistant',
      content: expandVariables(firstMsgSource, { ...ctx, chara: currentChar })
        .text,
    })
  }

  for (const msg of ms) {
    messages.push({
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: expandVariables(msg.data, { ...ctx, chara: currentChar }).text,
    })
  }

  return { messages }
}
