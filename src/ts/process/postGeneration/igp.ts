import { cloneJsonValue, dispatchUpdateMessageScoped, type ChatScopedSnapshot } from '../../chatCommands'
import { parseChatML } from '../../parser/chatML'
import { getDatabase } from '../../storage/database.svelte'
import { requestChatData } from '../request/request'
import { risuChatParser } from '../scripts'

export interface IgpMessageTarget {
  characterId: string
  chatId: string
  messageId: string
  expectedData: string
  expectedGenerationId?: string
}

export interface EvaluateIgpOptions {
  promptTemplate: string
  abortSignal: AbortSignal
  /**
   * Stable post-terminal row identity for server-backed generations. IGP only
   * appends while this exact derived text is still current, and carries the
   * same conditions into the durable message command.
   */
  target: IgpMessageTarget
}

function formatIgpAppendPayload(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'result' in value) {
    return formatIgpAppendPayload((value as { result?: unknown }).result)
  }
  if (value === null || value === undefined) return ''
  try {
    const json = JSON.stringify(value)
    if (json !== undefined) return json
  } catch {
    // Fall through to String for non-serializable objects.
  }
  return String(value)
}

function captureIgpTargetSnapshot(target: IgpMessageTarget): ChatScopedSnapshot | undefined {
  const characters = getDatabase().characters
  if (!Array.isArray(characters)) return undefined
  const selectedChar = characters.findIndex((candidate) => candidate?.chaId === target.characterId)
  const character = characters[selectedChar]
  if (selectedChar < 0 || !character?.chats) return undefined
  const chat = character.chats.find((candidate) => candidate?.id === target.chatId)
  if (!chat) return undefined
  const message = chat.message?.find((candidate) => candidate?.chatId === target.messageId)
  if (!message || message.data !== target.expectedData) return undefined
  if (
    target.expectedGenerationId !== undefined &&
    message.generationInfo?.generationId !== target.expectedGenerationId
  ) {
    return undefined
  }

  return {
    selectedCharID: selectedChar,
    characterId: target.characterId,
    chatId: target.chatId,
    chat: cloneJsonValue(chat),
  }
}

export async function evaluateIgp(opts: EvaluateIgpOptions): Promise<void> {
  const parsed = risuChatParser(opts.promptTemplate ?? '')
  if (!parsed) return
  const formated = parseChatML(parsed)
  const rq = await requestChatData({ formated, bias: {} }, 'emotion', opts.abortSignal)
  const appended = formatIgpAppendPayload(rq)
  const previous = captureIgpTargetSnapshot(opts.target)
  if (!previous) return
  dispatchUpdateMessageScoped(opts.target.messageId, { data: opts.target.expectedData + appended }, previous, {
    expectedData: opts.target.expectedData,
    expectedChatId: opts.target.chatId,
    expectedGenerationId: opts.target.expectedGenerationId,
  })
}
