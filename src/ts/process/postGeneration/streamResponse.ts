import {
  getDatabase,
  type Chat,
  type Message,
  type MessageGenerationInfo,
  type MessagePresetInfo,
  type character,
} from '../../storage/database.svelte'
import { trimUntilPunctuation } from '../../util'
import { withTrustedResourceWrite } from '../../server/resourceWriteGuard.svelte'
import type { StreamResponseChunk, requestDataResponse } from '../request/request'
import { processScriptFull } from '../scripts'
import { createStreamRenderCoalescer, type RenderFlushScheduler } from './streamCoalescer'

type StreamingResponse = Extract<requestDataResponse, { type: 'streaming' }>

export interface ConsumeStreamResponseOptions {
  req: StreamingResponse
  arg: { continue?: boolean }
  nowChatroom: character
  currentChar: character
  selectedChar: number
  selectedChat: number
  /** Stable generation owner. Numeric indices are only compatibility hints. */
  targetCharacterId?: string
  targetChatId?: string
  generationId: string
  generationInfo: MessageGenerationInfo
  promptInfo: MessagePresetInfo
  abortSignal: AbortSignal
  reformatContent: (data: string) => string
  /**
   * When the server owns post-generation, skip `editoutput` here; the server runs
   * it and ships final text on the terminal `done` frame. The browser still writes
   * streamed reformatted text for live display.
   */
  skipEditOutput?: boolean
  /**
   * Test seam: overrides the animation-frame scheduler the render coalescer
   * uses. Production callers omit it (`defaultRenderFlushScheduler`).
   */
  renderFlushScheduler?: RenderFlushScheduler
}

export interface ConsumeStreamResponseResult {
  result: string
  emoChanged: boolean
  msgIndex: number
  lastResponseChunk: StreamResponseChunk
  streamAborted: boolean
}

export async function consumeStreamResponse(opts: ConsumeStreamResponseOptions): Promise<ConsumeStreamResponseResult> {
  const {
    req,
    arg,
    nowChatroom,
    currentChar,
    selectedChar,
    selectedChat,
    generationId,
    generationInfo,
    promptInfo,
    abortSignal,
    reformatContent,
    skipEditOutput,
  } = opts

  const reader = req.result.getReader()
  const streamCharacterId = opts.targetCharacterId || currentChar.chaId
  const currentLiveCharacter = (): character | undefined => {
    const characters = getDatabase().characters
    if (!Array.isArray(characters)) return undefined
    const indexedCharacter = characters[selectedChar]
    if (!streamCharacterId || indexedCharacter?.chaId === streamCharacterId) return indexedCharacter
    return characters.find((candidate) => candidate?.chaId === streamCharacterId)
  }
  let streamChatId: string | undefined = opts.targetChatId
  const currentLiveChat = (): Chat | undefined => {
    const chats = currentLiveCharacter()?.chats
    if (!Array.isArray(chats)) return undefined
    const indexedChat = chats[selectedChat]
    if (!streamChatId || indexedChat?.id === streamChatId) return indexedChat
    return chats.find((chat) => chat.id === streamChatId)
  }
  const bumpReloadKey = (): void => {
    const character = currentLiveCharacter()
    if (character) character.reloadKeys += 1
  }
  const initialChat = currentLiveChat()
  if (!initialChat) {
    throw new Error('Active chat is unavailable for the streaming response')
  }
  streamChatId = initialChat.id
  const initialMessages = Array.isArray(initialChat.message) ? initialChat.message : []
  let msgIndex = initialMessages.length
  let prefix = ''
  let streamTargetMessageId: string | undefined = generationId
  let anonymousStreamTarget: Message | undefined
  if (arg.continue) {
    msgIndex -= 1
    const continueTarget = initialMessages[msgIndex]
    prefix = continueTarget?.data ?? ''
    streamTargetMessageId = continueTarget?.chatId
    if (!streamTargetMessageId) anonymousStreamTarget = continueTarget
  } else {
    const existingGeneratedIndex = initialMessages.findIndex(
      (message) =>
        message?.role === 'char' &&
        (message.chatId === generationId || message.generationInfo?.generationId === generationId),
    )
    if (existingGeneratedIndex >= 0) {
      // A durable reattach replays the same generation. Reuse its partial row
      // instead of appending a second empty assistant message.
      msgIndex = existingGeneratedIndex
      streamTargetMessageId = initialMessages[existingGeneratedIndex]?.chatId ?? generationId
    } else {
      withTrustedResourceWrite(() => {
        const targetChat = currentLiveChat()
        if (!targetChat) {
          throw new Error('Active chat is unavailable for the streaming response')
        }
        targetChat.message ??= []
        targetChat.message.push({
          role: 'char',
          data: '',
          saying: currentChar.chaId,
          time: Date.now(),
          generationInfo,
          promptInfo,
          chatId: generationId,
        })
      })
    }
  }

  const findStreamMessageIndex = (messages: readonly Message[]): number => {
    if (streamTargetMessageId) {
      const index = messages.findIndex((message) => message?.chatId === streamTargetMessageId)
      if (index >= 0) return index
    }
    if (generationId) {
      const index = messages.findIndex(
        (message) => message?.chatId === generationId || message?.generationInfo?.generationId === generationId,
      )
      if (index >= 0) return index
    }
    // Legacy rows can lack ids. Preserve compatibility only while the exact
    // object captured at dispatch remains resident; never reinterpret msgIndex
    // as permission to write a different row after an authoritative replace.
    return anonymousStreamTarget ? messages.indexOf(anonymousStreamTarget) : -1
  }

  const resolveStreamMessage = (): { chat: Chat; index: number; message: Message } | null => {
    const chat = currentLiveChat()
    const messages = chat?.message
    if (!chat || !Array.isArray(messages)) return null
    const index = findStreamMessageIndex(messages)
    if (index < 0) return null
    const message = messages[index]
    if (!message) return null
    return { chat, index, message }
  }

  withTrustedResourceWrite(() => {
    const targetChat = currentLiveChat()
    if (targetChat) targetChat.isStreaming = true
    bumpReloadKey()
  })
  let lastResponseChunk: StreamResponseChunk = {}
  let streamAborted: boolean = abortSignal.aborted
  let result = ''
  let emoChanged = false
  // Every `.data` write + `reloadKeys` bump re-runs
  // `risuChatParser` + `ParseMarkdown` over the whole growing message, so apply
  // the newest accumulated chunk at most once per animation frame instead of
  // once per token. `settle()` below guarantees the final full-fidelity apply
  // (including `editoutput`) before this function returns.
  const applyLatestChunk = async (): Promise<void> => {
    const targetBeforeScript = resolveStreamMessage()
    if (!targetBeforeScript) return
    msgIndex = targetBeforeScript.index
    let nextData: string
    if (skipEditOutput) {
      // The server owns `editoutput`; write the reformatted stream for display
      // and defer final text to the terminal `done` frame.
      nextData = reformatContent(prefix + result)
    } else {
      const result2 = await processScriptFull(nowChatroom, reformatContent(prefix + result), 'editoutput', msgIndex)
      nextData = result2.data
      emoChanged = result2.emoChanged
    }
    withTrustedResourceWrite(() => {
      const target = resolveStreamMessage()
      if (!target) return
      msgIndex = target.index
      target.message.data = nextData
      bumpReloadKey()
    })
  }
  const renderCoalescer = createStreamRenderCoalescer(applyLatestChunk, opts.renderFlushScheduler)
  const removeEmptyGeneratedMessage = (): void => {
    if (arg.continue) return
    if (result.length > 0 && !streamAborted && !abortSignal.aborted) return
    const target = resolveStreamMessage()
    if (!target) return
    if (target.message.role !== 'char') return
    if ((target.message.data ?? '').length > 0) return
    target.chat.message.splice(target.index, 1)
  }
  const abortReader = () => {
    streamAborted = true
    void reader.cancel().catch(() => {})
  }
  abortSignal.addEventListener('abort', abortReader, { once: true })
  try {
    while (streamAborted === false) {
      let readed: ReadableStreamReadResult<StreamResponseChunk>
      try {
        readed = await reader.read()
      } catch (error) {
        if (abortSignal.aborted || streamAborted) {
          streamAborted = true
          break
        }
        throw error
      }
      if (readed.value) {
        lastResponseChunk = readed.value
        const firstChunkKey = Object.keys(lastResponseChunk)[0]
        result = lastResponseChunk[firstChunkKey]
        if (!result) {
          result = ''
        }
        if (getDatabase().removeIncompleteResponse) {
          result = trimUntilPunctuation(result)
        }
        renderCoalescer.notify()
        if (renderCoalescer.failed) {
          // An apply rejected (script error); stop reading and surface it via
          // `settle()` below, like the old per-chunk await failed fast.
          break
        }
      }
      if (readed.done) {
        break
      }
    }
    await renderCoalescer.settle()
  } finally {
    abortSignal.removeEventListener('abort', abortReader)
    // When the loop threw (reader error), still apply the last received chunk;
    // swallow apply errors here so they cannot mask the propagating one.
    await renderCoalescer.settle().catch(() => {})
    withTrustedResourceWrite(() => {
      // A successful server stream supplies either tokens or `done.result`.
      // Therefore an empty generated row at stream termination is a placeholder
      // left by abort/transport failure and should never remain in the transcript.
      removeEmptyGeneratedMessage()
      const targetChat = currentLiveChat()
      if (targetChat) targetChat.isStreaming = false
      bumpReloadKey()
    })
    void reader.cancel().catch(() => {})
  }

  return { result, emoChanged, msgIndex, lastResponseChunk, streamAborted }
}
