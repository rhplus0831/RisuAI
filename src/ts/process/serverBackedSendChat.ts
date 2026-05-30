import { DBState } from '../stores.svelte'
import type {
  character,
  Chat,
  Message,
  MessageGenerationInfo,
  MessagePresetInfo,
} from '../storage/database.svelte'
import { withTrustedServerProjectionWrite } from '../server/projectionWriteGuard.svelte'
import { getInlayAsset } from './files/inlays'
import { runInlayScreen } from './inlayScreen'
import { applyServerHypaV3Progress } from './request/serverMemory'
import { applyServerChatRestoration, applyServerMessagePatch } from './request/serverMessagePatch'
import {
  requestServerChat,
  requestServerChatGeneration,
  type ServerChatInput,
  type ServerChatTerminal,
} from './request/serverChat'
import type { ServerChatMessagePatch } from './request/serverChatEvents'
import type { DispatchSuccessReq } from './dispatch/dispatchRequest'
import type { OpenAIChat } from './index.svelte'
import { sayTTS } from './tts'

export interface ServerBackedStageTimings {
  stage1Start: number
  stage1Duration: number
}

type ServerChatAnyResult =
  | Awaited<ReturnType<typeof requestServerChat>>
  | Awaited<ReturnType<typeof requestServerChatGeneration>>

export type ServerBackedDispatch = {
  req: DispatchSuccessReq
  generationId: string
  generationInfo: MessageGenerationInfo
  terminal: Promise<ServerChatTerminal>
}

export type ServerBackedAssemblyResult =
  | { status: 'aborted' }
  | { status: 'failed'; error: string; currentChat: Chat }
  | { status: 'preview'; formated?: OpenAIChat[]; body?: string }
  | {
      status: 'assembled'
      currentChat: Chat
      formated: OpenAIChat[]
      biases: [string, number][]
      inputTokens: number
      outputTokens: number
      dispatch?: ServerBackedDispatch
    }

export type ServerBackedTerminalResult =
  | { status: 'ok'; currentChat: Chat; resendChat: boolean }
  | { status: 'failed'; error: string; currentChat: Chat; resendChat: boolean }

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isServerChatGenerationOk(
  served: ServerChatAnyResult,
): served is Extract<Awaited<ReturnType<typeof requestServerChatGeneration>>, { status: 'ok' }> {
  return served.status === 'ok' && 'req' in served
}

function findGeneratedAssistantMessage(chat: Chat, generationId: string): Message | undefined {
  const byId = chat.message.find((message) => message.chatId === generationId)
  if (byId?.role === 'char') return byId
  return [...chat.message]
    .reverse()
    .find(
      (message) => message.role === 'char' && message.generationInfo?.generationId === generationId,
    )
}

function serverChatMode(args: {
  preview?: boolean
  previewPrompt?: boolean
  regenerateMessageId?: string
  continue?: boolean
}): ServerChatInput['mode'] {
  if (args.previewPrompt) return 'preview_prompt'
  if (args.preview) return 'preview'
  if (typeof args.regenerateMessageId === 'string') return 'regenerate'
  if (args.continue) return 'continue'
  return 'send'
}

// Apply the server's `message_patch` to the local projection only. `/generate/chat`
// persists assembly-time chat-var deltas itself, so the browser no longer replays
// them as `PATCH .../scriptstate` commands. `applyServerMessagePatch` still writes
// `chatVarMutations` into the live chat so the local view reflects the write
// without a refresh; the SSE revision keeps the cached command revision in sync.
function applyServerMessagePatches(args: {
  patches: ServerChatMessagePatch[]
  selectedChar: number
  selectedChat: number
}): Chat {
  const { patches, selectedChar, selectedChat } = args
  for (const patch of patches) {
    withTrustedServerProjectionWrite(() => {
      const liveChat = DBState.db.characters[selectedChar].chats[selectedChat]
      applyServerMessagePatch(liveChat, patch)
    })
  }
  return DBState.db.characters[selectedChar].chats[selectedChat]
}

/** One inlay asset shipped on the `/generate/chat` request `inlayAssets`. */
interface ServerInlayAssetPayload {
  id: string
  type: 'image' | 'video' | 'audio' | 'signature'
  base64: string
  width?: number
  height?: number
}

const INLAY_MARKER_RE = /{{(inlay|inlayed|inlayeddata)::(.+?)}}/g

/**
 * Inlay bytes (`{{inlay/inlayed/inlayeddata::id}}`) live only in the browser's
 * localForage `inlayStorage`; the server has no copy. Resolve every inlay id the
 * chat references and ship the bytes so the server `getInlay` can return them.
 *
 * Id-collection mirrors `formatHistoryMessage.ts:73-91`: `char`-role messages
 * surface only `inlayeddata` ids (the SPA quirk where `inlay`/`inlayed` tags are
 * stripped from a bot turn without surfacing their assets); every other role
 * surfaces all three tag types.
 */
async function collectServerInlayAssets(chat: Chat): Promise<ServerInlayAssetPayload[]> {
  const ids = new Set<string>()
  for (const message of chat.message ?? []) {
    if (typeof message.data !== 'string') continue
    for (const match of message.data.matchAll(INLAY_MARKER_RE)) {
      if (message.role === 'char' && match[1] !== 'inlayeddata') continue
      ids.add(match[2])
    }
  }

  const assets: ServerInlayAssetPayload[] = []
  for (const id of ids) {
    const inlay = await getInlayAsset(id)
    if (!inlay) continue
    if (
      inlay.type !== 'image' &&
      inlay.type !== 'video' &&
      inlay.type !== 'audio' &&
      inlay.type !== 'signature'
    ) {
      continue
    }
    const payload: ServerInlayAssetPayload = { id, type: inlay.type, base64: inlay.data }
    if (typeof inlay.width === 'number') payload.width = inlay.width
    if (typeof inlay.height === 'number') payload.height = inlay.height
    assets.push(payload)
  }
  return assets
}

export async function assembleServerBackedSendChat(args: {
  selectedChar: number
  selectedChat: number
  currentChar: character
  currentChat: Chat
  promptInfo: MessagePresetInfo
  stageTimings: ServerBackedStageTimings
  abortSignal: AbortSignal
  setProcessStage: (stage: number) => void
  preview?: boolean
  previewPrompt?: boolean
  continue?: boolean
  regenerateMessageId?: string
  /**
   * `resolveDurableGeneration === 'durable'` for this send. The server runs it as
   * a detached job and persists the result, so the coordinator suppresses the
   * browser's generation-result persist.
   */
  durable?: boolean
}): Promise<ServerBackedAssemblyResult> {
  // `resolveServerPromptAssembly` (the gate's classifier) has already verified
  // the structural precondition — for `mode === 'send'` the last message is a
  // text user message — before routing here, so the old silent `unavailable`
  // escape is gone. We only re-derive `userMessage` to populate the request body.
  const mode = serverChatMode(args)
  const lastMessage = args.currentChat.message.at(-1)
  const userMessage = mode === 'send' && lastMessage?.role === 'user' ? lastMessage.data : undefined

  args.setProcessStage(1)
  args.stageTimings.stage1Start = Date.now()
  const input: ServerChatInput = {
    chatId: args.currentChat.id ?? '',
    characterId: args.currentChar.chaId,
    mode,
  }
  if (typeof userMessage === 'string') {
    input.userMessage = userMessage
  }
  if (mode === 'regenerate') {
    input.regenerateMessageId = args.regenerateMessageId
  }
  // `send`, `continue`, and `regenerate` are durable-eligible. The caller already
  // gated `durable` on `resolveDurableGeneration`, so the server owns result
  // persistence for this job and the browser skips its own write.
  if (args.durable && (mode === 'send' || mode === 'continue' || mode === 'regenerate')) {
    input.durable = true
  }
  // Ship browser-only inlay bytes so the server assembler can inline image/asset
  // multimodals instead of dropping them. Asset-store bytes (`{{asset_prompt::}}`)
  // are resolved server-side and need no client payload.
  const inlayAssets = await collectServerInlayAssets(args.currentChat)
  if (inlayAssets.length > 0) {
    input.inlayAssets = inlayAssets
  }

  const wantsServerDispatch = !args.preview && !args.previewPrompt
  const served = wantsServerDispatch
    ? await requestServerChatGeneration(input, args.abortSignal)
    : await requestServerChat(input, args.abortSignal)

  if (served.status === 'aborted') return { status: 'aborted' }
  if (served.status === 'error') {
    const currentChat = applyServerMessagePatches({
      patches: served.messagePatches ?? [],
      selectedChar: args.selectedChar,
      selectedChat: args.selectedChat,
    })
    return { status: 'failed', error: served.error, currentChat }
  }

  args.stageTimings.stage1Duration =
    numberFrom(served.info?.timings?.prompt) ?? Date.now() - args.stageTimings.stage1Start

  if (args.preview || args.previewPrompt) {
    if (args.previewPrompt) {
      const promptText = served.prompt.promptInfo?.promptText
      return { status: 'preview', body: typeof promptText === 'string' ? promptText : '' }
    }
    return {
      status: 'preview',
      formated: (served.prompt.formated as OpenAIChat[]) ?? [],
    }
  }

  const currentChat = applyServerMessagePatches({
    patches: served.messagePatches,
    selectedChar: args.selectedChar,
    selectedChat: args.selectedChat,
  })

  if (!served.prompt.formated) {
    return {
      status: 'failed',
      error: 'server prompt assembly did not return formated rows',
      currentChat,
    }
  }

  const promptText = served.prompt.promptInfo?.promptText
  if (Array.isArray(promptText)) {
    args.promptInfo.promptText = promptText as OpenAIChat[]
  }

  const dispatch =
    wantsServerDispatch && isServerChatGenerationOk(served)
      ? {
          req: served.req,
          generationId: served.generationId,
          generationInfo: served.generationInfo,
          terminal: served.terminal,
        }
      : undefined

  return {
    status: 'assembled',
    currentChat,
    formated: served.prompt.formated,
    biases: served.prompt.biases ?? [],
    inputTokens:
      numberFrom(served.info?.tokens?.prompt) ??
      numberFrom(served.prompt.promptInfo?.inputTokens) ??
      0,
    outputTokens:
      numberFrom(served.info?.responseBudget) ??
      numberFrom(served.prompt.promptInfo?.outputTokens) ??
      DBState.db.maxResponse,
    ...(dispatch ? { dispatch } : {}),
  }
}

/**
 * Re-attach to a live durable generation instead of starting a fresh send. The
 * server replays buffered `prompt` / `info` / `token` frames over
 * `GET /generate/chat/:jobId/stream`, so the coordinator can drive the same
 * orchestrate -> terminal -> stage4 flow. There is no client-side assembly; the
 * running job already owns the prompt. A 404 surfaces as `failed`, and the
 * coordinator falls back to the persisted projection.
 */
export async function reattachServerBackedSendChat(args: {
  selectedChar: number
  selectedChat: number
  currentChar: character
  currentChat: Chat
  promptInfo: MessagePresetInfo
  stageTimings: ServerBackedStageTimings
  abortSignal: AbortSignal
  setProcessStage: (stage: number) => void
  jobId: string
  /** The running job's generating mode, so the reattach renders correctly. */
  continue?: boolean
  regenerateMessageId?: string
}): Promise<ServerBackedAssemblyResult> {
  args.setProcessStage(1)
  args.stageTimings.stage1Start = Date.now()
  // The reattach stream is keyed by jobId (the body mode is not what selects the
  // buffered frames), but carrying the real mode keeps `input.mode` honest and lets
  // the caller render continue/regenerate on the right row.
  const mode: ServerChatInput['mode'] =
    typeof args.regenerateMessageId === 'string'
      ? 'regenerate'
      : args.continue
        ? 'continue'
        : 'send'
  const input: ServerChatInput = {
    chatId: args.currentChat.id ?? '',
    characterId: args.currentChar.chaId,
    mode,
  }
  if (mode === 'regenerate') input.regenerateMessageId = args.regenerateMessageId
  const served = await requestServerChatGeneration(input, args.abortSignal, args.jobId)

  if (served.status === 'aborted') return { status: 'aborted' }
  if (served.status === 'error') {
    const currentChat = applyServerMessagePatches({
      patches: served.messagePatches ?? [],
      selectedChar: args.selectedChar,
      selectedChat: args.selectedChat,
    })
    return { status: 'failed', error: served.error, currentChat }
  }

  args.stageTimings.stage1Duration =
    numberFrom(served.info?.timings?.prompt) ?? Date.now() - args.stageTimings.stage1Start

  const currentChat = applyServerMessagePatches({
    patches: served.messagePatches,
    selectedChar: args.selectedChar,
    selectedChat: args.selectedChat,
  })

  if (!served.prompt.formated) {
    return {
      status: 'failed',
      error: 'reattached generation did not return formated rows',
      currentChat,
    }
  }

  const promptText = served.prompt.promptInfo?.promptText
  if (Array.isArray(promptText)) {
    args.promptInfo.promptText = promptText as OpenAIChat[]
  }

  const dispatch = isServerChatGenerationOk(served)
    ? {
        req: served.req,
        generationId: served.generationId,
        generationInfo: served.generationInfo,
        terminal: served.terminal,
      }
    : undefined

  return {
    status: 'assembled',
    currentChat,
    formated: served.prompt.formated,
    biases: served.prompt.biases ?? [],
    inputTokens:
      numberFrom(served.info?.tokens?.prompt) ??
      numberFrom(served.prompt.promptInfo?.inputTokens) ??
      0,
    outputTokens:
      numberFrom(served.info?.responseBudget) ??
      numberFrom(served.prompt.promptInfo?.outputTokens) ??
      DBState.db.maxResponse,
    ...(dispatch ? { dispatch } : {}),
  }
}

export async function applyServerBackedTerminal(args: {
  terminal: ServerChatTerminal
  currentChar: character
  selectedChar: number
  selectedChat: number
  generationInfo: MessageGenerationInfo
  /** Continue/regenerate target message id, so the post-gen final text + inlay land
   * on the right row when it is not keyed by `generationId` (the continue case). */
  targetMessageId?: string
}): Promise<ServerBackedTerminalResult> {
  const terminalInfo = args.terminal.done?.generationInfo
  if (terminalInfo && typeof terminalInfo === 'object') {
    Object.assign(args.generationInfo, terminalInfo)
  }
  if (args.terminal.status === 'error') {
    if (args.terminal.restoration) {
      withTrustedServerProjectionWrite(() => {
        const liveChat = DBState.db.characters[args.selectedChar].chats[args.selectedChat]
        applyServerChatRestoration(liveChat, args.terminal.restoration!)
      })
    }
    return {
      status: 'failed',
      error: args.terminal.error ?? 'provider dispatch failed',
      currentChat: DBState.db.characters[args.selectedChar].chats[args.selectedChat],
      resendChat: false,
    }
  }

  for (const sideEffect of args.terminal.sideEffects ?? []) {
    switch (sideEffect.kind) {
      case 'tts': {
        const payload = sideEffect.payload
        if (!payload || typeof payload !== 'object') break
        const text = (payload as { text?: unknown }).text
        if (typeof text === 'string' && text.length > 0) {
          await sayTTS(args.currentChar, text)
        }
        break
      }
      case 'hypav3_progress':
        applyServerHypaV3Progress(sideEffect.payload)
        break
      default:
        break
    }
  }

  // Apply the server-owned post-generation derivation. The browser skipped
  // `editoutput` and `applyOutputTrigger` on this path, so here it applies the
  // post-gen patch, renders the inlay screen over the server-owned final text, and
  // reports any resend request back to the coordinator.
  const postGen = args.terminal.done?.postGeneration
  const resendChat = !!postGen?.resendChat
  const generationId = args.generationInfo.generationId ?? ''
  let inlayPromise: Promise<string> | undefined
  let assistant: Message | undefined
  withTrustedServerProjectionWrite(() => {
    const liveChat = DBState.db.characters[args.selectedChar].chats[args.selectedChat]
    if (postGen?.messagePatch) {
      applyServerMessagePatch(liveChat, postGen.messagePatch)
    }
    assistant =
      findGeneratedAssistantMessage(liveChat, generationId) ??
      (args.targetMessageId
        ? liveChat.message.find(
            (message) => message.chatId === args.targetMessageId && message.role === 'char',
          )
        : undefined)
    if (assistant) {
      const baseText = typeof postGen?.finalText === 'string' ? postGen.finalText : assistant.data
      const inlay = runInlayScreen(args.currentChar, baseText)
      assistant.data = inlay.text
      inlayPromise = inlay.promise ?? undefined
    }
  })
  if (inlayPromise && assistant) {
    const resolved = await inlayPromise
    const ref = assistant
    withTrustedServerProjectionWrite(() => {
      ref.data = resolved
    })
  }

  return {
    status: 'ok',
    currentChat: DBState.db.characters[args.selectedChar].chats[args.selectedChat],
    resendChat,
  }
}
