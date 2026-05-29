import { get, writable } from 'svelte/store'
import { type character, type MessageGenerationInfo } from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { reportSendChatError } from './sendChatErrors'
import { setupSendChatContext } from './sendChatContext'
import { orchestrateResponse } from './postGeneration/orchestrateResponse'
import { runStage4 } from './postGeneration/runStage4'
import { dispatchRequest } from './dispatch/dispatchRequest'
import type { DispatchSuccessReq } from './dispatch/dispatchRequest'
import { resolveServerPromptAssembly } from './request/serverPromptAssembly'
import { resolveDurableGeneration } from './request/durableGeneration'
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
    // Durable generation (Milestone 1): when the send is durable-eligible, the server
    // runs it as a detached job and persists the result itself, so the browser drops
    // its own generation-result persist (gotcha F).
    let serverDurable = false

    // Server-side prompt assembly with browser-side patch replay. Send-like
    // calls consume the `/chat` provider stream; preview modes only read the
    // assembled prompt payload. `resolveServerPromptAssembly` mirrors
    // `resolveServerCompletionRoute`: in Fastify mode with the experimental
    // `useServerPromptAssembly` master-enable on, the supported text-send subset
    // is server-mandatory (`server`) and every out-of-subset send hard-fails
    // (`unsupported`) — there is no silent local fall-through. `local` (the
    // `!assembledByServer` branch below) is reached only when the server path is
    // not engaged: `!isFastifyServer` (dev/web/tests) or the flag is off. Neither
    // the flag nor the local fallback is deprecated — see the flag's JSDoc in
    // database.svelte.ts; removing them is the END of the prompt-assembly thinning
    // sub-family, not a precursor.
    const assemblyRoute = resolveServerPromptAssembly({
      currentChar,
      currentChat,
      preview: arg.preview,
      previewPrompt: arg.previewPrompt,
      continue: arg.continue,
      regenerateMessageId: arg.regenerateMessageId,
    })
    if (assemblyRoute.type === 'unsupported') {
      throwError(assemblyRoute.reason)
      return false
    }
    if (assemblyRoute.type === 'server') {
      // Durable subset (Milestone 1): a server-assembled `send` survives disconnect +
      // is persisted server-side. A restriction of `resolveServerPromptAssembly`, so it
      // is only ever `durable` when this branch already routed `server`.
      serverDurable =
        resolveDurableGeneration({
          currentChar,
          currentChat,
          preview: arg.preview,
          previewPrompt: arg.previewPrompt,
          continue: arg.continue,
          regenerateMessageId: arg.regenerateMessageId,
        }).type === 'durable'
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
        durable: serverDurable,
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
    // assemblyRoute.type === 'local' falls through to the local assembler below.

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
      // A2: the server owns the post-gen derivation (editoutput + run-var +
      // output trigger) on the server-dispatch path; the browser relays the
      // stream for display and applies the terminal patch instead of deriving.
      serverOwnsPostGeneration: !!serverDispatch,
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
    // A2: on the server-dispatch path the resend request rides the terminal
    // (`done.postGeneration.resendChat`); orchestrate no longer derives it.
    let resendChat = orchestrate.resendChat

    if (serverTerminal) {
      const terminal = await serverTerminal
      const terminalResult = await applyServerBackedTerminal({
        terminal,
        currentChar,
        selectedChar,
        selectedChat,
        generationInfo,
        targetMessageId: serverGenerationTargetMessageId,
      })
      currentChat = terminalResult.currentChat
      if (terminalResult.status === 'failed') {
        throwError(terminalResult.error)
        return false
      }
      if (terminalResult.resendChat) {
        resendChat = true
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
    if (serverDispatch && !serverDurable) {
      // Non-durable server dispatch: the browser persists the result (B2). On the
      // durable path the server already persisted it at job completion (Step 3), so
      // the browser reconciles the terminal-frame revision instead (EC-D4: zero
      // generation-result POSTs).
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
