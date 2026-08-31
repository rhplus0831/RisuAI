import { addRerolls } from '../prereroll'
import { runInlayScreen } from '../inlayScreen'
import { sayTTS } from '../tts'
import { evaluateIgp } from './igp'
import { applyOutputTrigger } from './outputTrigger'
import { applyNonStreamResponse } from './nonStreamResponse'
import { consumeStreamResponse } from './streamResponse'
import type { StreamMessageProjection } from './streamResponse'
import {
  type Chat,
  type MessageGenerationInfo,
  type MessagePresetInfo,
  type character,
} from '../../storage/database.svelte'
import { settingsResourceState } from '../../server/resourceState.svelte'
import type { DispatchSuccessReq } from '../dispatch/dispatchRequest'
import {
  mutateStablePostGenerationChat,
  mutateStablePostGenerationMessage,
  resolveStablePostGenerationChat,
  resolveStablePostGenerationMessage,
  stablePostGenerationChatTarget,
  stablePostGenerationMessageTarget,
} from './stableTarget'

export type OrchestrateResponseResult =
  | { status: 'aborted' }
  | {
      status: 'done'
      currentChat: Chat
      result: string
      emoChanged: boolean
      resendChat: boolean
      messageId?: string
      streamProjection?: StreamMessageProjection
    }

/**
 * Subset of the sendChat `arg` parameter the orchestrator forwards onto the
 * stream / non-stream helpers (the `continue` mode flag).
 */
export interface OrchestrateResponseArg {
  continue?: boolean
}

export interface OrchestrateResponseArgs {
  req: DispatchSuccessReq
  arg: OrchestrateResponseArg
  nowChatroom: character
  currentChar: character
  /** Captured chat value used for non-mutating result/side-effect context. */
  currentChat: Chat
  selectedChar: number
  selectedChat: number
  targetCharacterId?: string
  targetChatId?: string
  generationId: string
  generationInfo: MessageGenerationInfo
  promptInfo: MessagePresetInfo
  abortSignal: AbortSignal
  reformatContent: (data: string) => string
  runCurrentChatFunction: (chat: Chat) => Chat
  suppressStreamingTts?: boolean
  /**
   * The server owns post-generation derivation (`editoutput`, the pre-trigger
   * run-var pass, and the `'output'` trigger). When set, this orchestrator relays
   * the stream for live display only and defers final-text write, inlay rendering,
   * scriptstate patch, and resend handling to the terminal `done.postGeneration`.
   */
  serverOwnsPostGeneration?: boolean
}

/**
 * Run the post-dispatch response stage: route to the streaming or
 * non-streaming response helper, apply the shared output-trigger, drive
 * the streaming-only inlay / TTS side effects, and run IGP.
 *
 * Returns a discriminated union. The coordinator owns:
 *   - `status: 'aborted'`  → return false from sendChat.
 *   - `status: 'done'`     → continue into stage 4 with `currentChat`,
 *     `result`, `emoChanged`, `resendChat`.
 */
export async function orchestrateResponse(args: OrchestrateResponseArgs): Promise<OrchestrateResponseResult> {
  const {
    req,
    arg,
    nowChatroom,
    currentChar,
    selectedChar,
    selectedChat,
    targetCharacterId,
    targetChatId,
    generationId,
    generationInfo,
    promptInfo,
    abortSignal,
    reformatContent,
    runCurrentChatFunction,
    suppressStreamingTts,
    serverOwnsPostGeneration,
  } = args
  let currentChat = args.currentChat
  let result = ''
  let emoChanged = false
  let resendChat = false
  let outputMessageId: string | undefined
  let streamProjection: StreamMessageProjection | undefined
  const stableChatTarget = stablePostGenerationChatTarget(targetCharacterId, targetChatId)

  if (req.type === 'streaming') {
    const stream = await consumeStreamResponse({
      req,
      arg,
      nowChatroom,
      currentChar,
      selectedChar,
      selectedChat,
      targetCharacterId,
      targetChatId,
      generationId,
      generationInfo,
      promptInfo,
      abortSignal,
      reformatContent,
      skipEditOutput: serverOwnsPostGeneration,
    })
    result = stream.result
    streamProjection = stream.projection
    outputMessageId = stream.projection?.messageId
    emoChanged = stream.emoChanged

    if (stream.streamAborted || abortSignal.aborted) {
      return { status: 'aborted' }
    }

    if (!serverOwnsPostGeneration) {
      addRerolls(generationId, Object.values(stream.lastResponseChunk))
    }

    if (serverOwnsPostGeneration) {
      // The server already ran the run-var pass, `'output'` trigger, and
      // `editoutput`. The browser keeps streamed text for display; final text,
      // inlay rendering, scriptstate patch, and resend arrive on the terminal.
      currentChat = resolveStablePostGenerationChat(stableChatTarget)?.chat ?? currentChat
    } else {
      const streamTrigger = await applyOutputTrigger({
        currentChar,
        currentChat,
        target: stableChatTarget,
        runCurrentChatFunction,
      })
      currentChat = streamTrigger.triggerChat ?? streamTrigger.chat
      if (streamTrigger.resendChat) {
        resendChat = true
      }
      let inlayr: ReturnType<typeof runInlayScreen> | undefined
      mutateStablePostGenerationChat(stableChatTarget, (chat, character) => {
        if (streamTrigger.triggerChat) {
          const chatIndex = character.chats.indexOf(chat)
          if (chatIndex < 0 || streamTrigger.triggerChat.id !== chat.id) return false
          character.chats[chatIndex] = streamTrigger.triggerChat
        }
        return true
      })
      const messageTarget = stablePostGenerationMessageTarget(
        stableChatTarget?.characterId,
        stableChatTarget?.chatId,
        outputMessageId,
      )
      mutateStablePostGenerationMessage(messageTarget, (message, chat) => {
        currentChat = chat
        inlayr = runInlayScreen(currentChar, message.data)
        message.data = inlayr.text
      })
      if (inlayr?.promise) {
        const t = await inlayr.promise
        mutateStablePostGenerationMessage(messageTarget, (message, chat) => {
          currentChat = chat
          message.data = t
        })
      }
      if (
        settingsResourceState.status !== 'error' &&
        settingsResourceState.groupStatuses.media === 'ready' &&
        settingsResourceState.value.ttsAutoSpeech === true &&
        !suppressStreamingTts
      ) {
        await sayTTS(currentChar, result)
      }
    }
  } else {
    const nonStream = await applyNonStreamResponse({
      req,
      arg,
      nowChatroom,
      currentChar,
      target: stableChatTarget,
      generationId,
      generationInfo,
      promptInfo,
      reformatContent,
      skipEditOutput: serverOwnsPostGeneration,
    })
    result = nonStream.result
    emoChanged = nonStream.emoChanged
    outputMessageId = nonStream.messageId
    if (nonStream.mrerolls.length > 1) {
      addRerolls(generationId, nonStream.mrerolls)
    }

    // On the server-owned path, the `'output'` trigger ran server-side; the
    // browser consumes the terminal patch instead of deriving it here. Server
    // dispatch always streams, so this branch is local-only in practice.
    if (!serverOwnsPostGeneration) {
      const nonStreamTrigger = await applyOutputTrigger({
        currentChar,
        currentChat,
        target: stableChatTarget,
        runCurrentChatFunction,
      })
      if (nonStreamTrigger.triggerChat) {
        mutateStablePostGenerationChat(stableChatTarget, (chat, character) => {
          const chatIndex = character.chats.indexOf(chat)
          if (chatIndex < 0 || nonStreamTrigger.triggerChat!.id !== chat.id) return false
          character.chats[chatIndex] = nonStreamTrigger.triggerChat!
          currentChat = nonStreamTrigger.triggerChat!
          return true
        })
      } else {
        currentChat = nonStreamTrigger.chat
      }
      if (nonStreamTrigger.resendChat) {
        resendChat = true
      }
    }
  }

  if (!serverOwnsPostGeneration) {
    const messageTarget = stablePostGenerationMessageTarget(
      stableChatTarget?.characterId,
      stableChatTarget?.chatId,
      outputMessageId,
    )
    const messageResolution = resolveStablePostGenerationMessage(messageTarget)
    if (messageResolution && messageTarget) {
      await evaluateIgp({
        promptTemplate:
          settingsResourceState.status === 'ready' ? String(settingsResourceState.value.igpPrompt ?? '') : '',
        abortSignal,
        target: {
          ...messageTarget,
          expectedData: messageResolution.message.data,
          ...(messageResolution.message.generationInfo?.generationId
            ? { expectedGenerationId: messageResolution.message.generationInfo.generationId }
            : {}),
        },
      })
    }
  }

  return {
    status: 'done',
    currentChat,
    result,
    emoChanged,
    resendChat,
    ...(outputMessageId ? { messageId: outputMessageId } : {}),
    streamProjection,
  }
}
