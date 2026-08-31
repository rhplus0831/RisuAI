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
import {
  charactersResourceState,
  getCharacterResourceOwner,
  settingsResourceState,
} from '../../server/resourceState.svelte'
import type { StreamResponseChunk, requestDataResponse } from '../request/request'
import { processScriptFull } from '../scripts'
import { createStreamRenderCoalescer, type RenderFlushScheduler } from './streamCoalescer'
import { captureChatMessageMutationIntentEpoch } from '../../server/chatMessageMutationIntent'
import { captureChatBodyProjectionEpoch, hasChatBodyProjectionEpochChanged } from '../../server/resourceState.svelte'
import {
  beginHalfStreamingProgress,
  clearHalfStreamingProgress,
  recordHalfStreamingToken,
  type HalfStreamingProgressTarget,
} from '../halfStreamingProgress'
import {
  beginGenerationDisplayProjection,
  finishGenerationDisplayProjection,
  updateGenerationDisplayProjection,
  type GenerationDisplayProjectionRef,
} from '../generationDisplayProjection.svelte'
import { registerRetainedChatProjection } from '../../server/chatRetainedProjection'

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
  projection: StreamMessageProjection
}

export interface StreamMessageProjection {
  chatId?: string
  messageId?: string
  generationId: string
  previousData: string
  ownedData: string
  appended: boolean
  /** Stream ownership was lost to a newer projection or user mutation. */
  detached?: boolean
  /** Original generated-row slot, used when half-stream Stop removed its placeholder. */
  messageIndex?: number
  /** The stream crossed an explicit durable replay gap before terminal reconciliation. */
  gapTruncated?: boolean
  /** Transient target-row projection used instead of an authoritative message write. */
  displayProjection?: GenerationDisplayProjectionRef
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
    const characters =
      charactersResourceState.status === 'ready'
        ? charactersResourceState.characters
        : charactersResourceState.status === 'idle' || charactersResourceState.status === 'loading'
          ? getDatabase().characters
          : null
    if (!Array.isArray(characters)) return undefined
    if (charactersResourceState.status === 'ready') {
      return streamCharacterId ? getCharacterResourceOwner(streamCharacterId) : undefined
    }
    const indexedCharacter = characters[selectedChar]
    if (!streamCharacterId || indexedCharacter?.chaId === streamCharacterId) return indexedCharacter
    return characters.find((candidate) => candidate?.chaId === streamCharacterId)
  }
  let streamChatId: string | undefined = opts.targetChatId
  const currentLiveChat = (): Chat | undefined => {
    const character = currentLiveCharacter()
    const chats = character?.chats
    if (!Array.isArray(chats)) return undefined
    if (charactersResourceState.status === 'ready') {
      const candidate = streamChatId ? chats.find((chat) => chat.id === streamChatId) : chats[selectedChat]
      if (!candidate?.id) return undefined
      const matches = chats.filter((chat) => chat.id === candidate.id)
      return matches.length === 1 ? matches[0] : undefined
    }
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
  const halfStreaming = req.halfStreaming === true
  const halfStreamingTarget: HalfStreamingProgressTarget = {
    characterId: streamCharacterId,
    chatId: streamChatId,
    generationId,
  }
  if (halfStreaming && req.halfStreamingProgressManaged !== true) {
    beginHalfStreamingProgress(halfStreamingTarget)
  }
  const initialMessages = Array.isArray(initialChat.message) ? initialChat.message : []
  let msgIndex = initialMessages.length
  let prefix = ''
  let streamTargetMessageId: string | undefined = generationId
  let anonymousStreamTarget: Message | undefined
  let lastStreamOwnedData = ''
  let appendedGeneratedMessage = false
  let retainedAppendedMessage: Message | undefined
  let retainedTranscriptFence: Array<Pick<Message, 'chatId' | 'role' | 'data' | 'name'>> | undefined
  const displayProjection = req.generationDisplayProjection
  const projectsRegenerateTarget = displayProjection?.mode === 'regenerate' && !!displayProjection.targetMessageId
  const extendsContinue = arg.continue === true && req.continueDisposition !== 'append'
  if (projectsRegenerateTarget) {
    const targetIndex = initialMessages.findIndex((message) => message.chatId === displayProjection.targetMessageId)
    const target = initialMessages[targetIndex]
    if (targetIndex < 0 || target?.role !== 'char') {
      finishGenerationDisplayProjection(displayProjection)
      throw new Error('Regenerate display target is unavailable for the streaming response')
    }
    msgIndex = targetIndex
    streamTargetMessageId = displayProjection.targetMessageId
    lastStreamOwnedData = target.data ?? ''
    beginGenerationDisplayProjection(displayProjection)
    updateGenerationDisplayProjection(displayProjection, {
      generationId,
      status: 'preparing',
      gapTruncated: req.replayGapTruncated === true,
      projectionEpoch: displayProjection.projectionEpoch,
    })
  } else if (extendsContinue) {
    msgIndex -= 1
    const continueTarget = initialMessages[msgIndex]
    const visibleContinueData = continueTarget?.data ?? ''
    prefix = typeof req.continueBase === 'string' ? req.continueBase : visibleContinueData
    // A retried reattach can begin while the row already displays this
    // generation's prior partial. That visible value is still stream-owned;
    // only the composition prefix must come from the immutable server base.
    lastStreamOwnedData = visibleContinueData
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
      lastStreamOwnedData = initialMessages[existingGeneratedIndex]?.data ?? ''
    } else {
      withTrustedResourceWrite(() => {
        const targetChat = currentLiveChat()
        if (!targetChat) {
          throw new Error('Active chat is unavailable for the streaming response')
        }
        targetChat.message ??= []
        retainedTranscriptFence = targetChat.message.map((message) => ({
          chatId: message.chatId,
          role: message.role,
          data: message.data,
          name: message.name,
        }))
        retainedAppendedMessage = {
          role: 'char',
          data: '',
          saying: currentChar.chaId,
          time: Date.now(),
          generationInfo,
          promptInfo,
          chatId: generationId,
        }
        targetChat.message.push(retainedAppendedMessage)
        appendedGeneratedMessage = true
      })
    }
  }
  const preStreamData = lastStreamOwnedData

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

  let projectionEpoch = streamChatId ? captureChatBodyProjectionEpoch(streamChatId) : undefined
  const mutationIntentEpoch = streamChatId ? captureChatMessageMutationIntentEpoch(streamChatId) : undefined
  let streamDetached = false
  let releaseRetainedStreamProjection = () => {}

  const matchesRetainedTranscriptFence = (messages: readonly Message[]): boolean => {
    if (!retainedTranscriptFence || messages.length !== retainedTranscriptFence.length) return false
    return retainedTranscriptFence.every((expected, index) => {
      const message = messages[index]
      return (
        message?.chatId === expected.chatId &&
        message?.role === expected.role &&
        message?.data === expected.data &&
        message?.name === expected.name
      )
    })
  }

  if (appendedGeneratedMessage && streamChatId && retainedAppendedMessage && retainedTranscriptFence) {
    const transcriptFence = retainedTranscriptFence
    releaseRetainedStreamProjection = registerRetainedChatProjection(
      { kind: 'chat-body', chatId: streamChatId },
      () => {
        withTrustedResourceWrite(() => {
          if (streamDetached || !streamChatId || !retainedAppendedMessage) return
          if (
            mutationIntentEpoch !== undefined &&
            captureChatMessageMutationIntentEpoch(streamChatId) !== mutationIntentEpoch
          ) {
            streamDetached = true
            return
          }
          const targetChat = currentLiveChat()
          const messages = targetChat?.message
          if (!targetChat || !Array.isArray(messages)) {
            streamDetached = true
            return
          }
          const existingIndex = findStreamMessageIndex(messages)
          if (existingIndex >= 0) {
            const existing = messages[existingIndex]
            if (
              existingIndex !== transcriptFence.length ||
              !matchesRetainedTranscriptFence(messages.slice(0, existingIndex)) ||
              messages.length !== transcriptFence.length + 1 ||
              existing?.data !== lastStreamOwnedData
            ) {
              streamDetached = true
              return
            }
            retainedAppendedMessage = existing
            msgIndex = existingIndex
            projectionEpoch = captureChatBodyProjectionEpoch(streamChatId)
            return
          }
          if (!matchesRetainedTranscriptFence(messages)) {
            streamDetached = true
            return
          }
          const restored = structuredClone(retainedAppendedMessage)
          restored.data = lastStreamOwnedData
          messages.push(restored)
          retainedAppendedMessage = restored
          msgIndex = messages.length - 1
          projectionEpoch = captureChatBodyProjectionEpoch(streamChatId)
        })
      },
      () => {
        streamDetached = true
      },
    )
  }

  const ownsStreamTarget = (target: { message: Message } | null): boolean => {
    if (streamDetached) return false
    if (!target) {
      streamDetached = true
      return false
    }
    if (
      streamChatId &&
      ((projectionEpoch !== undefined && hasChatBodyProjectionEpochChanged(streamChatId, projectionEpoch)) ||
        (mutationIntentEpoch !== undefined &&
          captureChatMessageMutationIntentEpoch(streamChatId) !== mutationIntentEpoch))
    ) {
      streamDetached = true
      return false
    }
    if (target.message.data !== lastStreamOwnedData) {
      streamDetached = true
      return false
    }
    return true
  }

  withTrustedResourceWrite(() => {
    const targetChat = currentLiveChat()
    if (targetChat) targetChat.isStreaming = true
    bumpReloadKey()
  })
  let lastResponseChunk: StreamResponseChunk = {}
  let streamAborted: boolean = abortSignal.aborted
  let streamCompleted = false
  let result = ''
  let lastObservedResult = ''
  let emoChanged = false
  // Every `.data` write + `reloadKeys` bump re-runs
  // `risuChatParser` + `ParseMarkdown` over the whole growing message, so apply
  // the newest accumulated chunk at most once per animation frame instead of
  // once per token. `settle()` below guarantees the final full-fidelity apply
  // (including `editoutput`) before this function returns.
  const applyLatestChunk = async (): Promise<void> => {
    const targetBeforeScript = resolveStreamMessage()
    if (!ownsStreamTarget(targetBeforeScript)) return
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
    if (projectsRegenerateTarget) {
      const target = resolveStreamMessage()
      if (!ownsStreamTarget(target)) return
      msgIndex = target.index
      updateGenerationDisplayProjection(displayProjection, {
        generationId,
        status: 'streaming',
        text: nextData,
        gapTruncated: req.replayGapTruncated === true,
      })
      return
    }
    withTrustedResourceWrite(() => {
      const target = resolveStreamMessage()
      if (!ownsStreamTarget(target)) return
      msgIndex = target.index
      target.message.data = nextData
      lastStreamOwnedData = nextData
      bumpReloadKey()
    })
  }
  const renderCoalescer = createStreamRenderCoalescer(applyLatestChunk, opts.renderFlushScheduler)
  const removeEmptyGeneratedMessage = (): void => {
    if (projectsRegenerateTarget) return
    if (extendsContinue) return
    if (streamDetached) return
    if (result.length > 0 && (!halfStreaming || streamCompleted) && !streamAborted && !abortSignal.aborted) return
    const target = resolveStreamMessage()
    if (!ownsStreamTarget(target)) return
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
        const rawStreamedResult = result
        if (
          halfStreaming &&
          req.halfStreamingProgressManaged !== true &&
          rawStreamedResult.length > 0 &&
          rawStreamedResult !== lastObservedResult
        ) {
          recordHalfStreamingToken(halfStreamingTarget)
        }
        lastObservedResult = rawStreamedResult
        if (
          settingsResourceState.status === 'ready' &&
          (settingsResourceState.value as Record<string, unknown>).removeIncompleteResponse
        ) {
          result = trimUntilPunctuation(result)
        }
        if (!halfStreaming) renderCoalescer.notify()
        if (renderCoalescer.failed) {
          // An apply rejected (script error); stop reading and surface it via
          // `settle()` below, like the old per-chunk await failed fast.
          break
        }
      }
      if (readed.done) {
        streamCompleted = true
        break
      }
    }
    if (halfStreaming && streamCompleted && !streamAborted && !abortSignal.aborted) {
      renderCoalescer.notify()
    }
    if (halfStreaming && result.length > 0 && (streamAborted || abortSignal.aborted) && skipEditOutput !== true) {
      // Local providers have no server terminal snapshot to reconcile. Apply
      // their buffered partial through the normal client editoutput path before
      // abort cleanup decides whether the placeholder is empty.
      renderCoalescer.notify()
    }
    await renderCoalescer.settle()
  } finally {
    abortSignal.removeEventListener('abort', abortReader)
    // When the loop threw (reader error), still apply the last received chunk;
    // swallow apply errors here so they cannot mask the propagating one.
    await renderCoalescer.settle().catch(() => {})
    releaseRetainedStreamProjection()
    withTrustedResourceWrite(() => {
      // A successful server stream supplies either tokens or `done.result`.
      // Therefore an empty generated row at stream termination is a placeholder
      // left by abort/transport failure and should never remain in the transcript.
      removeEmptyGeneratedMessage()
      const targetChat = currentLiveChat()
      if (targetChat?.isStreaming) targetChat.isStreaming = false
      bumpReloadKey()
    })
    if (halfStreaming) clearHalfStreamingProgress(halfStreamingTarget)
    if (displayProjection && (streamAborted || abortSignal.aborted || !streamCompleted)) {
      finishGenerationDisplayProjection(displayProjection)
    }
    void reader.cancel().catch(() => {})
  }

  return {
    result,
    emoChanged,
    msgIndex,
    lastResponseChunk,
    streamAborted,
    projection: {
      chatId: streamChatId,
      messageId: streamTargetMessageId,
      generationId,
      previousData: preStreamData,
      ownedData: lastStreamOwnedData,
      appended: appendedGeneratedMessage,
      detached: streamDetached,
      messageIndex: msgIndex,
      gapTruncated: req.replayGapTruncated === true,
      ...(displayProjection ? { displayProjection } : {}),
    },
  }
}
