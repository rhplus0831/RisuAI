import { randomUUID } from 'node:crypto'
import type {
  Chat,
  Message,
  character,
} from '../../../../src/ts/storage/database.svelte'
import type { OpenAIChat } from '../../../../src/ts/process/index.svelte'
import { expandVariables, type ExpandContext } from './variables.js'
import { processScript } from './scripts.js'

/**
 * Phase 7-5a/b history walk ported from the SPA's
 * `src/ts/process/promptAssembly/buildHistoryWindow.ts`,
 * `formatHistoryMessage.ts`, and `src/ts/process/exampleMessages.ts`.
 *
 * 7-5a (landed): examples block, `[Start a new chat]` marker gated by
 * `!aiModel.startsWith('novelai') && !promptSettings.trimStartNewChat`,
 * first-message selection, `makeMs` filter for `disabled === true` /
 * `'allBefore'`, and per-message role mapping.
 *
 * 7-5b (this slice):
 *   - First message and per-message bodies flow through
 *     `processScript(ctx, char, data, 'editprocess', cbsConditions)`
 *     after a pre-pass through `expandVariables` (mirrors the SPA's
 *     `processScriptFull(char, risuChatParser(data, {chara, role}), 'editprocess', ...)`
 *     call at `formatHistoryMessage.ts:44-52`).
 *   - First message and per-message `sendName` wrapper (gated by
 *     `usingPromptTemplate && db.promptSettings.sendName`). The first
 *     message gets a `${char.name}: ` prefix and `attr: ['nameAdded']`.
 *     Per-message bodies get wrapped in
 *     `<{{char}}'s Message>\n{{slot}}\n</{{char}}'s Message>` with
 *     `{{char}}` resolved against the active `currentChar` (matches the
 *     SPA's effective behavior — the `chara: msg.saying` override at
 *     formatHistoryMessage.ts:140 is shadowed by the cbs `char` callback
 *     reading currentChar from scope first; see cbs.ts:184).
 *   - `<Thoughts>...</Thoughts>` extraction with the
 *     `maxThoughtTagDepth` clamp: always stripped from `content`,
 *     captured into `chat.thoughts: string[]` when
 *     `maxThoughtDepth === -1 || maxThoughtDepth - totalCount <= index`.
 *   - Per-message `memo` defaults to `msg.chatId`, backfilling
 *     `msg.chatId` with a UUID v4 when missing (mirrors `formatHistoryMessage.ts:69-71`).
 *
 * Deferred to later sub-slices: multimodal inlays + `{{asset_prompt::}}`
 * (7-5c), start trigger / `runTrigger` (7-5d), tokenizer accumulation +
 * depth-prompt preflight (7-5e).
 */

const SEND_NAME_WRAPPER = `<{{char}}'s Message>\n{{slot}}\n</{{char}}'s Message>`
const THOUGHTS_RE = /<Thoughts>(.+?)<\/Thoughts>/gms

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

function extractThoughts(
  content: string,
  index: number,
  totalCount: number,
  maxThoughtDepth: number,
): { content: string; thoughts: string[] } {
  const thoughts: string[] = []
  const stripped = content.replace(THOUGHTS_RE, (_match, body: string) => {
    if (maxThoughtDepth === -1 || maxThoughtDepth - totalCount <= index) {
      thoughts.push(body)
    }
    return ''
  })
  return { content: stripped, thoughts }
}

function formatHistoryMessage(
  ctx: ExpandContext,
  currentChar: character,
  msg: Message,
  index: number,
  totalCount: number,
  usingPromptTemplate: boolean,
): OpenAIChat {
  const db = ctx.database
  const sendName = !!db.promptSettings?.sendName
  const maxThoughtDepth = db.promptSettings?.maxThoughtTagDepth ?? -1

  const preExpanded = expandVariables(msg.data ?? '', {
    ...ctx,
    chara: currentChar,
    role: msg.role,
  }).text

  let formatted = processScript(
    ctx,
    currentChar,
    preExpanded,
    'editprocess',
    { chatRole: msg.role },
  )

  if (!msg.chatId) {
    msg.chatId = randomUUID()
  }

  if (usingPromptTemplate && sendName) {
    // SPA passes `chara: findCharacterbyIdwithCache(msg.saying).name` here,
    // but the `{{char}}` cbs callback reads the active currentChar from
    // scope before consulting `matcherArg.chara` (cbs.ts:184), so the
    // override is dead code in practice. We mirror the effective behavior.
    const wrapped = expandVariables(SEND_NAME_WRAPPER, {
      ...ctx,
      chara: currentChar,
    }).text
    formatted = wrapped.replace('{{slot}}', formatted)
  }

  const { content, thoughts } = extractThoughts(
    formatted,
    index,
    totalCount,
    maxThoughtDepth,
  )

  const chat: OpenAIChat = {
    role: msg.role === 'user' ? 'user' : 'assistant',
    content,
    memo: msg.chatId,
  }
  if (thoughts.length > 0) chat.thoughts = thoughts
  return chat
}

export interface HistoryWindowResult {
  messages: OpenAIChat[]
}

export function buildHistoryWindow(
  ctx: ExpandContext,
  currentChar: character,
  currentChat: Chat,
  usingPromptTemplate: boolean = false,
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
    const preExpanded = expandVariables(firstMsgSource, {
      ...ctx,
      chara: currentChar,
    }).text
    let content = processScript(
      ctx,
      currentChar,
      preExpanded,
      'editprocess',
    )
    const firstMessage: OpenAIChat = { role: 'assistant', content }
    if (usingPromptTemplate && db.promptSettings?.sendName) {
      firstMessage.content = `${currentChar.name}: ${content}`
      firstMessage.attr = ['nameAdded']
    }
    messages.push(firstMessage)
  }

  for (let i = 0; i < ms.length; i++) {
    messages.push(
      formatHistoryMessage(
        ctx,
        currentChar,
        ms[i],
        i,
        ms.length,
        usingPromptTemplate,
      ),
    )
  }

  return { messages }
}
