import { get, writable } from 'svelte/store'
import { type character, type MessageGenerationInfo } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { reportSendChatError } from './sendChatErrors'
import { setupSendChatContext } from './sendChatContext'
import { orchestrateResponse } from './postGeneration/orchestrateResponse'
import { runStage4 } from './postGeneration/runStage4'
import { dispatchRequest } from './dispatch/dispatchRequest'
import type { DispatchSuccessReq } from './dispatch/dispatchRequest'
import { isFastifyServer } from '../platform'
import {
  applyServerBackedTerminal,
  assembleServerBackedSendChat,
  persistServerBackedGenerationResult,
  type ServerBackedDispatch,
} from './serverBackedSendChat'
import {
  assembleLocalSendChatPrompt,
  createSendChatCharacterCache,
  runSendChatMessageVariables,
} from './sendChatPromptAssembly'

export interface OpenAIChat {
  role: 'system' | 'user' | 'assistant' | 'function'
  content: string
  memo?: string
  name?: string
  removable?: boolean
  attr?: string[]
  multimodals?: MultiModal[]
  thoughts?: string[]
  cachePoint?: boolean
}

export interface MultiModal {
  type: 'image' | 'video' | 'audio' | 'signature'
  base64: string
  height?: number
  width?: number
}

export interface requestTokenPart {
  name: string
  tokens: number
}

export const doingChat = writable(false)
export const chatProcessStage = writable(0)
export const abortChat = writable(false)
export let requestTokenParts: { [key: string]: requestTokenPart[] } = {}
export let previewFormated: OpenAIChat[] = []
export let previewBody: string = ''

export async function sendChat(
  chatProcessIndex = -1,
  arg: {
    chatAdditonalTokens?: number
    signal?: AbortSignal
    continue?: boolean
    usedContinueTokens?: number
    preview?: boolean
    previewPrompt?: boolean
    regenerateMessageId?: string
  } = {},
): Promise<boolean> {
  chatProcessStage.set(0)
  const abortSignal = arg.signal ?? new AbortController().signal

  // NOTE: `throwError()` can be called before these are populated (e.g. HypaV3 early validation errors).
  // Keep them declared up-front to avoid TDZ ReferenceErrors in production builds.
  let selectedChar = -1
  let selectedChat = -1
  let currentChar: character
  let generationInfo: MessageGenerationInfo | undefined = undefined

  const stageTimings = {
    stage1Start: 0,
    stage2Start: 0,
    stage3Start: 0,
    stage4Start: 0,
    stage1Duration: 0,
    stage2Duration: 0,
    stage3Duration: 0,
    stage4Duration: 0,
  }

  const findCharacterbyIdwithCache = createSendChatCharacterCache()
  const runCurrentChatFunction = (chat: Parameters<typeof runSendChatMessageVariables>[0]) =>
    runSendChatMessageVariables(chat, currentChar)

  function reformatContent(data: string) {
    if (chatProcessIndex === -1) {
      return data.trim()
    }
    return data.trim()
  }

  function throwError(error: string) {
    reportSendChatError(error, {
      selectedChar,
      selectedChat,
      currentChar,
      generationInfo,
    })
  }

  let isDoing = get(doingChat)

  if (isDoing) {
    if (chatProcessIndex === -1) {
      return false
    }
  }
  // iOwnDoingChat contract: this call sets `doingChat = true` on entry and
  // the `finally` clears it on exit only when this flag is true. Three states:
  //   (a) own         — fresh call, finally clears.
  //   (b) reentrant   — chatProcessIndex !== -1 while doingChat is already
  //                     true; we never took ownership, finally must not clear.
  //   (c) handoff     — auto-continue or sendAIprompt resend recurse into
  //                     sendChat. The inner call's entry guard refuses on
  //                     `chatProcessIndex === -1` while doingChat is true, so
  //                     before recursing we clear `doingChat` manually AND
  //                     set `iOwnDoingChat = false` so the outer finally
  //                     does not re-clear after the inner finally already did.
  let iOwnDoingChat = false
  if (!isDoing) {
    doingChat.set(true)
    iOwnDoingChat = true
  }

  try {
    const setProcessStage = (stage: number) => chatProcessStage.set(stage)
    const ctx = setupSendChatContext({
      chatProcessIndex,
      chatAdditonalTokens: arg.chatAdditonalTokens,
    })
    selectedChar = ctx.selectedChar
    selectedChat = ctx.selectedChat
    const nowChatroom = ctx.nowChatroom
    const promptInfo = ctx.promptInfo
    const tokenizer = ctx.tokenizer
    const maxContextTokens = ctx.maxContextTokens

    currentChar = nowChatroom
    let currentChat = nowChatroom.chats[selectedChat]

    let formated: OpenAIChat[] = []
    let biases: [string, number][] = []
    let inputTokens = 0
    let outputTokens = DBState.db.maxResponse
    let assembledByServer = false
    let serverDispatch: ServerBackedDispatch | undefined

    // Server-side prompt assembly with browser-side patch replay. Send-like
    // calls now consume the `/chat` provider stream; preview modes still only
    // read the assembled prompt payload.
    // Server prompt assembly is gated behind the (default-off) experimental
    // `useServerPromptAssembly` flag; the `!assembledByServer` fallback below is the
    // live local assembly path. Neither is deprecated — see the flag's JSDoc in
    // database.svelte.ts. Removing the fallback is the end of the prompt-assembly
    // thinning sub-family, not a precursor.
    if (isFastifyServer && DBState.db.useServerPromptAssembly) {
      const serverAssembly = await assembleServerBackedSendChat({
        selectedChar,
        selectedChat,
        currentChar,
        currentChat,
        promptInfo,
        stageTimings,
        abortSignal,
        setProcessStage,
        preview: arg.preview,
        previewPrompt: arg.previewPrompt,
        continue: arg.continue,
        regenerateMessageId: arg.regenerateMessageId,
      })
      if (serverAssembly.status === 'aborted') {
        return false
      }
      if (serverAssembly.status === 'failed') {
        currentChat = serverAssembly.currentChat
        throwError(serverAssembly.error)
        return false
      }
      if (serverAssembly.status === 'preview') {
        if (serverAssembly.body !== undefined) previewBody = serverAssembly.body
        if (serverAssembly.formated !== undefined) previewFormated = serverAssembly.formated
        return true
      }
      if (serverAssembly.status === 'assembled') {
        currentChat = serverAssembly.currentChat
        formated = serverAssembly.formated
        biases = serverAssembly.biases
        inputTokens = serverAssembly.inputTokens
        outputTokens = serverAssembly.outputTokens
        assembledByServer = true
        serverDispatch = serverAssembly.dispatch
        generationInfo = serverAssembly.dispatch?.generationInfo
      }
    }

    if (!assembledByServer) {
      const localAssembly = await assembleLocalSendChatPrompt({
        currentChar,
        currentChat,
        nowChatroom,
        selectedChar,
        selectedChat,
        tokenizer,
        promptInfo,
        maxContextTokens,
        stageTimings,
        isContinue: !!arg.continue,
        findCharacterbyIdwithCache,
        throwError,
        setProcessStage,
      })
      if (localAssembly.status === 'stopped') {
        return false
      }
      currentChat = localAssembly.currentChat
      formated = localAssembly.formated
      biases = localAssembly.biases
      inputTokens = localAssembly.inputTokens
      outputTokens = localAssembly.outputTokens
    }

    let req: DispatchSuccessReq
    let generationId: string
    let serverTerminal: ServerBackedDispatch['terminal'] | undefined
    const serverGenerationTargetMessageId =
      serverDispatch && arg.continue ? currentChat.message.at(-1)?.chatId : undefined
    if (serverDispatch) {
      setProcessStage(3)
      stageTimings.stage3Start = Date.now()
      req = serverDispatch.req
      generationId = serverDispatch.generationId
      generationInfo = serverDispatch.generationInfo
      serverTerminal = serverDispatch.terminal
    } else {
      const dispatch = await dispatchRequest({
        formated,
        biases,
        currentChar,
        nowChatroom,
        inputTokens,
        outputTokens,
        maxContextTokens,
        stageTimings,
        abortSignal,
        isContinue: !!arg.continue,
        isPreview: !!arg.preview,
        isPreviewPrompt: !!arg.previewPrompt,
        setProcessStage,
      })
      if (dispatch.status === 'preview') {
        previewFormated = dispatch.formated
        return true
      }
      if (dispatch.status === 'previewPrompt') {
        previewBody = dispatch.body
        return true
      }
      if (dispatch.status === 'aborted') {
        return false
      }
      if (dispatch.status === 'failed') {
        generationInfo = dispatch.generationInfo
        throwError(dispatch.reason)
        return false
      }
      req = dispatch.req
      generationId = dispatch.generationId
      generationInfo = dispatch.generationInfo
    }

    const orchestrate = await orchestrateResponse({
      req,
      arg,
      nowChatroom,
      currentChar,
      currentChat,
      selectedChar,
      selectedChat,
      generationId,
      generationInfo,
      promptInfo,
      abortSignal,
      reformatContent,
      runCurrentChatFunction,
      suppressStreamingTts: !!serverDispatch,
    })
    if (orchestrate.status === 'aborted') {
      return false
    }
    if (orchestrate.status === 'continue') {
      // Handoff — see iOwnDoingChat contract above.
      doingChat.set(false)
      iOwnDoingChat = false
      return await sendChat(chatProcessIndex, {
        chatAdditonalTokens: arg.chatAdditonalTokens,
        continue: true,
        signal: abortSignal,
        usedContinueTokens: orchestrate.resultTokens,
      })
    }
    currentChat = orchestrate.currentChat
    const result = orchestrate.result
    const emoChanged = orchestrate.emoChanged
    const resendChat = orchestrate.resendChat

    if (serverTerminal) {
      const terminal = await serverTerminal
      const terminalResult = await applyServerBackedTerminal({
        terminal,
        currentChar,
        selectedChar,
        selectedChat,
        generationInfo,
      })
      currentChat = terminalResult.currentChat
      if (terminalResult.status === 'failed') {
        throwError(terminalResult.error)
        return false
      }
    }

    const stage4 = await runStage4({
      req,
      currentChar,
      result,
      resendChat,
      emoChanged,
      abortSignal,
      selectedChar,
      selectedChat,
      stageTimings,
      generationInfo,
      throwError,
      setProcessStage,
    })
    if (stage4.status === 'resend') {
      // Handoff — see iOwnDoingChat contract above.
      doingChat.set(false)
      iOwnDoingChat = false
      return await sendChat(chatProcessIndex, {
        signal: abortSignal,
      })
    }
    if (serverDispatch) {
      persistServerBackedGenerationResult({
        currentChat,
        generationId,
        targetMessageId: serverGenerationTargetMessageId,
      })
    }
    return true
  } finally {
    if (iOwnDoingChat) {
      doingChat.set(false)
    }
  }
}
