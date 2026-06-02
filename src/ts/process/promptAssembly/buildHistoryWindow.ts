// @ts-nocheck
import { DBState } from '../../stores.svelte'
import {
  setCurrentChat,
  type Chat,
  type Message,
  type character,
} from '../../storage/database.svelte'
import type { ChatTokenizer } from '../../tokenizer'
import { getUserName } from '../../util'
import { exampleMessage } from '../exampleMessages'
import type { OpenAIChat } from '../index.svelte'
import type { LoreActive } from './buildLorebookContext'
import { formatHistoryMessage } from './formatHistoryMessage'
import { processScript, risuChatParser } from '../scripts'
import { runTrigger } from '../triggers'

export interface BuildHistoryWindowArgs {
  currentChar: character
  currentChat: Chat
  usingPromptTemplate: boolean
  tokenizer: ChatTokenizer
  findCharacterbyIdwithCache: (id: string) => character
  depthPrompts: LoreActive[]
  resolvePosition: (text: string) => string
}

/**
 * runTrigger's documented success return shape. Reused for the discriminated
 * union below; the helper itself accepts whatever runTrigger returns.
 */
export type StartTriggerResult = Awaited<ReturnType<typeof runTrigger>>

export type BuildHistoryWindowResult =
  | { stopSending: true }
  | {
      stopSending: false
      chats: OpenAIChat[]
      /** Delta to add to the coordinator's currentTokens. */
      addedTokens: number
      /** Possibly mutated by the start trigger. */
      currentChat: Chat
      /** Forwarded to the coordinator's later additonalSysPrompt block. */
      triggerResult: StartTriggerResult
    }

/**
 * Assemble the chat history window: examples + start-new-chat marker +
 * first message + makeMs filter + start-trigger handling + per-message
 * formatting + depth-prompt token preflight.
 *
 * Returns either { stopSending: true } when the start trigger asked to
 * abort, or the full window plus the trigger result for downstream
 * additonalSysPrompt processing.
 */
export async function buildHistoryWindow(
  args: BuildHistoryWindowArgs,
): Promise<BuildHistoryWindowResult> {
  const {
    currentChar,
    usingPromptTemplate,
    tokenizer,
    findCharacterbyIdwithCache,
    depthPrompts,
    resolvePosition,
  } = args
  let currentChat = args.currentChat
  const nowChatroom = currentChar

  let addedTokens = 0

  const examples = exampleMessage(currentChar, getUserName())
  for (const example of examples) {
    addedTokens += await tokenizer.tokenizeChat(example)
  }

  const chats: OpenAIChat[] = examples

  if (!DBState.db.aiModel.startsWith('novelai') && !DBState.db?.promptSettings?.trimStartNewChat) {
    chats.push({
      role: 'system',
      content: '[Start a new chat]',
      memo: 'NewChat',
    })
  }

  let msReseted = false
  const makeMs = (chat: Chat): Message[] => {
    const mss: Message[] = []
    msReseted = false
    for (let i = chat.message.length - 1; i >= 0; i--) {
      const d = chat.message[i]
      if (d.disabled === true) {
        continue
      }
      if (d.disabled === 'allBefore') {
        msReseted = true
        break
      }
      mss.unshift(d)
    }
    return mss
  }

  let ms: Message[] = makeMs(currentChat)

  if (!msReseted) {
    const firstMsg =
      currentChat.fmIndex === -1
        ? nowChatroom.firstMessage
        : nowChatroom.alternateGreetings[currentChat.fmIndex]

    const chat: OpenAIChat = {
      role: 'assistant',
      content: await processScript(
        nowChatroom,
        risuChatParser(firstMsg, { chara: currentChar }),
        'editprocess',
      ),
    }

    if (usingPromptTemplate && DBState.db.promptSettings.sendName) {
      chat.content = `${currentChar.name}: ${chat.content}`
      chat.attr = ['nameAdded']
    }
    chats.push(chat)
    addedTokens += await tokenizer.tokenizeChat(chat)
  }

  const triggerResult = await runTrigger(currentChar, 'start', { chat: currentChat })
  if (triggerResult) {
    currentChat = triggerResult.chat
    setCurrentChat(currentChat)
    ms = makeMs(currentChat)
    addedTokens += triggerResult.tokens
    if (triggerResult.stopSending) {
      return { stopSending: true }
    }
  }

  let index = 0
  for (const msg of ms) {
    const chat = await formatHistoryMessage({
      msg,
      index,
      totalCount: ms.length,
      currentChar,
      usingPromptTemplate,
      findCharacterbyIdwithCache,
    })
    chats.push(chat)
    addedTokens += await tokenizer.tokenizeChat(chat)
    index++
  }

  for (const depthPrompt of depthPrompts) {
    const chat: OpenAIChat = {
      role: depthPrompt.role,
      content: risuChatParser(resolvePosition(depthPrompt.prompt), { chara: currentChar }),
    }
    addedTokens += await tokenizer.tokenizeChat(chat)
  }

  return {
    stopSending: false,
    chats,
    addedTokens,
    currentChat,
    triggerResult,
  }
}
