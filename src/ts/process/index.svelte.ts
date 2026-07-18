import { get, writable } from 'svelte/store'
import { type character, type MessageGenerationInfo } from '../storage/database.svelte'
import { getResourceDatabase as getDatabase } from '../server/resourceState.svelte'
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
  reattachServerBackedSendChat,
  type ServerBackedDispatch,
} from './serverBackedSendChat'
import {
  assembleLocalSendChatPrompt,
  createSendChatCharacterCache,
  runSendChatMessageVariables,
} from './sendChatPromptAssembly'
import { guardActiveChatGenerationSettingsForSend } from '../activeChatGenerationSettings'
import { alertError } from '../alert'
import {
  captureActiveChatTarget,
  isActiveChatTargetFresh,
  waitForPendingChatGenerationSettingsSave,
  type ActiveChatTarget,
} from '../chatCommands'
import { flushPendingSelectedPersonaUpdate } from '../persona'
import { language } from '../../lang'

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
export const activeGenerationTarget = writable<ActiveChatTarget | null>(null)
export const chatProcessStage = writable(0)
export const abortChat = writable(false)
export let requestTokenParts: { [key: string]: requestTokenPart[] } = {}
export let previewFormated: OpenAIChat[] = []
export let previewBody: string = ''

let activeGenerationAbortController: AbortController | null = null
const MAX_SERVER_RESEND_DEPTH = 1
const SERVER_RESEND_CAP_ERROR = 'Server-requested resend limit reached. Stopping to avoid a repeated generation loop.'
const CHAT_GENERATION_SETTINGS_SAVE_ERROR =
  'Chat generation settings could not be saved before generation. Please retry.'
const SELECTED_PERSONA_SAVE_ERROR = 'Persona settings could not be saved before generation. Please retry.'

export interface SendChatArgs {
  chatAdditonalTokens?: number
  signal?: AbortSignal
  continue?: boolean
  preview?: boolean
  previewPrompt?: boolean
  regenerateMessageId?: string
  expectedTarget?: ActiveChatTarget | null
  /** Internal circuit-breaker depth for server-owned postGeneration resends. */
  serverResendDepth?: number
  /**
   * Re-attach to this live durable generation (server job id) instead of
   * starting a fresh send. Skips assembly + the provider POST; the server
   * replays the in-flight stream.
   */
  reattachJobId?: string
}

function chatGenerationSettingsSaveError(
  result: NonNullable<Awaited<ReturnType<typeof waitForPendingChatGenerationSettingsSave>>>,
): string {
  if (result.status === 'error') return result.error
  if (result.status === 'conflict') return CHAT_GENERATION_SETTINGS_SAVE_ERROR
  return CHAT_GENERATION_SETTINGS_SAVE_ERROR
}

function selectedPersonaSaveError(
  result: NonNullable<Awaited<ReturnType<typeof flushPendingSelectedPersonaUpdate>>>,
): string {
  if (result.status === 'error') return result.error
  if (result.status === 'conflict') return SELECTED_PERSONA_SAVE_ERROR
  return SELECTED_PERSONA_SAVE_ERROR
}

function isExpectedTargetFresh(target: ActiveChatTarget | null | undefined): boolean {
  return target === undefined || isActiveChatTargetFresh(target)
}

export function createActiveGenerationAbortController(): AbortController {
  const controller = new AbortController()
  activeGenerationAbortController = controller
  abortChat.set(false)
  return controller
}

export function clearActiveGenerationAbortController(controller: AbortController): void {
  if (activeGenerationAbortController === controller) {
    activeGenerationAbortController = null
  }
}

export function abortActiveGeneration(): void {
  abortChat.set(true)
  activeGenerationAbortController?.abort()
}

export async function sendChat(chatProcessIndex = -1, arg: SendChatArgs = {}): Promise<boolean> {
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
  const generationTarget = arg.expectedTarget === undefined ? captureActiveChatTarget() : arg.expectedTarget

  if (!isExpectedTargetFresh(generationTarget)) {
    return false
  }

  if (isDoing) {
    if (chatProcessIndex === -1) {
      return false
    }
  }

  if (!arg.reattachJobId) {
    const generationSettingsGuard = guardActiveChatGenerationSettingsForSend()
    if (generationSettingsGuard.status === 'error') {
      alertError(generationSettingsGuard.error)
      return false
    }
  }

  // iOwnDoingChat contract: this call sets `doingChat = true` on entry and
  // the `finally` clears it on exit only when this flag is true. Three states:
  //   (a) own         — fresh call, finally clears.
  //   (b) reentrant   — chatProcessIndex !== -1 while doingChat is already
  //                     true; we never took ownership, finally must not clear.
  //   (c) handoff     — a stage-4 `resend` recurses into
  //                     sendChat. The inner call's entry guard refuses on
  //                     `chatProcessIndex === -1` while doingChat is true, so
  //                     before recursing we clear `doingChat` manually AND
  //                     set `iOwnDoingChat = false` so the outer finally
  //                     does not re-clear after the inner finally already did.
  let iOwnDoingChat = false
  if (!isDoing) {
    activeGenerationTarget.set(generationTarget)
    doingChat.set(true)
    iOwnDoingChat = true
  }

  try {
    const setProcessStage = (stage: number) => chatProcessStage.set(stage)
    if (!isExpectedTargetFresh(generationTarget)) {
      return false
    }
    const ctx = setupSendChatContext({
      chatProcessIndex,
      chatAdditonalTokens: arg.chatAdditonalTokens,
      writeMaintenance: !arg.reattachJobId,
    })
    selectedChar = ctx.selectedChar
    selectedChat = ctx.selectedChat
    const nowChatroom = ctx.nowChatroom
    const promptInfo = ctx.promptInfo
    const tokenizer = ctx.tokenizer
    const maxContextTokens = ctx.maxContextTokens

    currentChar = nowChatroom
    let currentChat = nowChatroom.chats[selectedChat]

    if (!arg.reattachJobId) {
      const contextPersistence = await ctx.persistence
      if (!isExpectedTargetFresh(generationTarget)) {
        return false
      }
      if (contextPersistence.status !== 'ok') {
        alertError(language.errors.sendContextPersistenceFailed)
        return false
      }
      const settingsSaveResult = await waitForPendingChatGenerationSettingsSave(currentChat.id)
      if (!isExpectedTargetFresh(generationTarget)) {
        return false
      }
      if (settingsSaveResult && settingsSaveResult.status !== 'ok') {
        throwError(chatGenerationSettingsSaveError(settingsSaveResult))
        return false
      }
      const personaSaveResult = await flushPendingSelectedPersonaUpdate()
      if (!isExpectedTargetFresh(generationTarget)) {
        return false
      }
      if (personaSaveResult && personaSaveResult.status !== 'ok') {
        throwError(selectedPersonaSaveError(personaSaveResult))
        return false
      }
      currentChat = nowChatroom.chats[selectedChat]
      const generationSettingsGuard = guardActiveChatGenerationSettingsForSend()
      if (generationSettingsGuard.status === 'error') {
        alertError(generationSettingsGuard.error)
        return false
      }
    }

    let formated: OpenAIChat[] = []
    let biases: [string, number][] = []
    let inputTokens = 0
    let outputTokens = getDatabase().maxResponse
    let assembledByServer = false
    let serverDispatch: ServerBackedDispatch | undefined
    // When the send is durable-eligible, the server runs it as a detached job and
    // persists the result itself, so the browser drops its own generation-result
    // persist.
    let serverDurable = false

    // Server-side prompt assembly with browser-side patch replay. Send-like calls
    // consume the `/chat` provider stream; preview modes only read the assembled
    // prompt payload. In Fastify mode, supported text sends are server-mandatory
    // and out-of-subset sends hard-fail instead of silently falling through to
    // local assembly. The local branch remains for compatibility tests.
    if (arg.reattachJobId) {
      // Re-attach to a live durable generation instead of assembling and
      // dispatching a fresh send. The job is server-persisted, so the browser only
      // renders the replayed stream.
      serverDurable = true
      const reattached = await reattachServerBackedSendChat({
        selectedChar,
        selectedChat,
        currentChar,
        currentChat,
        promptInfo,
        stageTimings,
        abortSignal,
        setProcessStage,
        jobId: arg.reattachJobId,
        // Carry the running job's mode so the replayed stream renders on the
        // correct row; see `serverGenerationTargetMessageId`.
        continue: arg.continue,
        regenerateMessageId: arg.regenerateMessageId,
      })
      if (reattached.status === 'aborted') return false
      if (reattached.status === 'failed') {
        // Job GC'd / already completed: the result is persisted, so the
        // projection refresh surfaces it. Nothing to render live.
        return false
      }
      if (reattached.status === 'assembled') {
        currentChat = reattached.currentChat
        formated = reattached.formated
        biases = reattached.biases
        inputTokens = reattached.inputTokens
        outputTokens = reattached.outputTokens
        assembledByServer = true
        serverDispatch = reattached.dispatch
        generationInfo = reattached.dispatch?.generationInfo
      }
    }

    const assemblyRoute = arg.reattachJobId
      ? ({ type: 'local' } as const)
      : resolveServerPromptAssembly({
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
      // Durable server-assembled sends survive disconnect and are persisted
      // server-side. This can only be `durable` after prompt assembly routes to
      // the server.
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
    const serverGenerationTargetCharacterId = serverDispatch ? currentChar.chaId : undefined
    const serverGenerationTargetChatId = serverDispatch ? currentChat.id : undefined
    const serverGenerationTargetMessageId =
      serverDispatch && arg.continue ? currentChat.message.at(-1)?.chatId : undefined
    if (serverDispatch) {
      setProcessStage(3)
      stageTimings.stage3Start = Date.now()
      req = serverDispatch.req
      generationId = serverDispatch.generationId
      generationInfo = serverDispatch.generationInfo
      serverTerminal = serverDispatch.terminal
      // Durable cancel-on-abort is owned by the SSE consumer
      // (`requestServerChatGeneration`): it captures the jobId from `job_accepted`
      // and issues the DELETE on any abort — including mid-assembly — so it is not
      // wired here (a bare disconnect only detaches; an explicit stop cancels).
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
      targetCharacterId: serverGenerationTargetCharacterId ?? currentChar.chaId,
      targetChatId: serverGenerationTargetChatId ?? currentChat.id,
      generationId,
      generationInfo,
      promptInfo,
      abortSignal,
      reformatContent,
      runCurrentChatFunction,
      suppressStreamingTts: !!serverDispatch,
      // The server owns post-gen derivation on the server-dispatch path; the
      // browser relays the stream and applies the terminal patch instead.
      serverOwnsPostGeneration: !!serverDispatch,
    })
    if (orchestrate.status === 'aborted') {
      return false
    }
    currentChat = orchestrate.currentChat
    const result = orchestrate.result
    const emoChanged = orchestrate.emoChanged
    // On the server-dispatch path, the resend request rides the terminal
    // (`done.postGeneration.resendChat`); orchestrate no longer derives it.
    let resendChat = orchestrate.resendChat

    let serverRequestedResend = false
    if (serverTerminal) {
      const terminal = await serverTerminal
      const terminalResult = await applyServerBackedTerminal({
        terminal,
        currentChar,
        currentChat,
        selectedChar,
        selectedChat,
        targetCharacterId: serverGenerationTargetCharacterId,
        targetChatId: serverGenerationTargetChatId,
        generationInfo,
        targetMessageId: serverGenerationTargetMessageId,
        restorationGuard: serverDispatch?.restorationGuard,
        streamProjection: orchestrate.streamProjection,
      })
      currentChat = terminalResult.currentChat
      if (terminalResult.status === 'failed') {
        throwError(terminalResult.error)
        return false
      }
      if (terminalResult.resendChat) {
        serverRequestedResend = true
        if ((arg.serverResendDepth ?? 0) >= MAX_SERVER_RESEND_DEPTH) {
          throwError(SERVER_RESEND_CAP_ERROR)
          return false
        }
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
      activeGenerationTarget.set(null)
      doingChat.set(false)
      iOwnDoingChat = false
      return await sendChat(chatProcessIndex, {
        signal: abortSignal,
        continue: serverRequestedResend ? true : undefined,
        ...(arg.expectedTarget !== undefined ? { expectedTarget: arg.expectedTarget } : {}),
        serverResendDepth: serverRequestedResend ? (arg.serverResendDepth ?? 0) + 1 : 0,
      })
    }
    // The server is the sole author of generation results on every
    // server-dispatch path. Durable jobs persist at completion; inline
    // continue/regenerate persists in the post-gen pass. The browser only
    // reconciles the terminal-frame revision and issues no generation-result
    // commands.
    return true
  } finally {
    if (iOwnDoingChat) {
      activeGenerationTarget.set(null)
      doingChat.set(false)
    }
  }
}
