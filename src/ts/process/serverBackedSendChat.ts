import {
  getDatabase,
  type character,
  type Chat,
  type Message,
  type MessageGenerationInfo,
  type MessagePresetInfo,
} from '../storage/database.svelte'
import { safeStructuredClone } from '../polyfill'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import { getInlayAssetMetadata, getServerInlayAssetId } from './files/inlays'
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
import { seedRerollBufferFromAlternates } from './rerollNavigation.svelte'
import { sayTTS } from './tts'
import { captureChatBodyProjectionEpoch, hasChatBodyProjectionEpochChanged } from '../server/resourceState.svelte'
import { captureChatMessageMutationIntentEpoch } from '../server/chatMessageMutationIntent'
import { finalizeServerBackedInlayMessage } from './inlayFinalization'

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

// Exported for regression tests; not part of the public API.
export function findGeneratedAssistantMessage(chat: Chat, generationId: string): Message | undefined {
  const byId = chat.message.find((message) => message.chatId === generationId)
  if (byId?.role === 'char') return byId
  // Scan newest-to-oldest in place — the former
  // `[...chat.message].reverse().find(...)` copied the whole transcript on
  // every terminal lookup just to find the last match.
  for (let i = chat.message.length - 1; i >= 0; i--) {
    const message = chat.message[i]
    if (message.role === 'char' && message.generationInfo?.generationId === generationId) {
      return message
    }
  }
  return undefined
}

/**
 * Turn provider multi-generation text choices into live reroll candidates. The
 * deterministic ids match the server's durable alternate records, so an
 * immediate live swipe and the next hydration address the same candidates.
 */
export function buildServerBackedAlternateMessages(
  assistant: Message,
  alternates: readonly unknown[],
  generationId: string,
): Message[] {
  const baseId = assistant.chatId || generationId || 'server-generation'
  return alternates.flatMap((value, index) => {
    if (typeof value !== 'string') return []
    const candidate = safeStructuredClone(assistant)
    candidate.data = value
    candidate.chatId = `${baseId}:alternate:${index + 1}`
    // A translation of the primary choice is stale for different source text.
    delete candidate.translation
    return [candidate]
  })
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

interface ServerBackedStableChatTarget {
  characterId?: string
  chatId?: string
}

interface ServerBackedLiveChatTarget extends ServerBackedStableChatTarget {
  selectedChar: number
  selectedChat: number
}

interface ServerBackedLiveChatResolution {
  character: character
  chat: Chat
}

function nonEmptyTargetId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function hasStableChatTarget(target: ServerBackedStableChatTarget | undefined): boolean {
  return nonEmptyTargetId(target?.characterId) && nonEmptyTargetId(target?.chatId)
}

function targetFromPayloadOrContext(
  payload: ServerBackedStableChatTarget | undefined,
  context: ServerBackedStableChatTarget,
): ServerBackedStableChatTarget {
  if (hasStableChatTarget(payload)) return payload ?? {}
  return hasStableChatTarget(context) ? context : {}
}

function resolveServerBackedLiveChat(target: ServerBackedLiveChatTarget): ServerBackedLiveChatResolution | undefined {
  const characters = getDatabase().characters
  if (!Array.isArray(characters)) return undefined

  if (hasStableChatTarget(target)) {
    const character = characters.find((candidate) => candidate?.chaId === target.characterId)
    const chat = character?.chats?.find((candidate) => candidate?.id === target.chatId)
    return character && chat ? { character, chat } : undefined
  }

  const character = characters[target.selectedChar]
  const chat = character?.chats?.[target.selectedChat]
  return character && chat ? { character, chat } : undefined
}

function unresolvedServerBackedChat(): Chat {
  return { message: [], note: '', name: '', localLore: [] } as Chat
}

function resolveServerBackedCurrentChat(target: ServerBackedLiveChatTarget & { currentChat?: Chat }): Chat {
  return resolveServerBackedLiveChat(target)?.chat ?? target.currentChat ?? unresolvedServerBackedChat()
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
  targetCharacterId?: string
  targetChatId?: string
  currentChat: Chat
}): Chat {
  const { patches, selectedChar, selectedChat } = args
  const contextTarget = { characterId: args.targetCharacterId, chatId: args.targetChatId }
  for (const patch of patches) {
    const target = targetFromPayloadOrContext(patch, contextTarget)
    withTrustedResourceWrite(() => {
      const resolution = resolveServerBackedLiveChat({
        selectedChar,
        selectedChat,
        characterId: target.characterId,
        chatId: target.chatId,
      })
      if (!resolution) return
      applyServerMessagePatch(resolution.chat, patch)
    })
  }
  return resolveServerBackedCurrentChat({
    selectedChar,
    selectedChat,
    characterId: args.targetCharacterId,
    chatId: args.targetChatId,
    currentChat: args.currentChat,
  })
}

/** Legacy browser-local inlay id mapped to a server-owned asset id. */
interface ServerInlayAssetRefPayload {
  id: string
  assetId: string
  width?: number
  height?: number
}

const INLAY_MARKER_RE = /{{(inlay|inlayed|inlayeddata)::(.+?)}}/g

/**
 * New Fastify inlay ids are server asset ids. For legacy browser-local ids,
 * upload the bytes once through the asset route and send only an id mapping so
 * the server resolves all prompt-time bytes from its own asset store.
 *
 * Id-collection mirrors the local history formatter: `char`-role messages surface
 * only `inlayeddata` ids (the SPA quirk where `inlay`/`inlayed` tags are stripped
 * from a bot turn without surfacing their assets); every other role surfaces all
 * three tag types.
 */
async function collectServerInlayAssetRefs(chat: Chat): Promise<ServerInlayAssetRefPayload[]> {
  const ids = new Set<string>()
  for (const message of chat.message ?? []) {
    if (typeof message.data !== 'string') continue
    for (const match of message.data.matchAll(INLAY_MARKER_RE)) {
      if (message.role === 'char' && match[1] !== 'inlayeddata') continue
      ids.add(match[2])
    }
  }

  const refs: ServerInlayAssetRefPayload[] = []
  for (const id of ids) {
    const assetId = await getServerInlayAssetId(id)
    if (!assetId || assetId === id) continue
    const metadata = await getInlayAssetMetadata(id)
    refs.push({
      id,
      assetId,
      ...(typeof metadata?.width === 'number' ? { width: metadata.width } : {}),
      ...(typeof metadata?.height === 'number' ? { height: metadata.height } : {}),
    })
  }
  return refs
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
  // New inlay tokens are server asset ids already. Legacy browser-local ids are
  // uploaded before dispatch and sent as id->assetId aliases only; no inlay bytes
  // ride the chat request anymore.
  const inlayAssetRefs = await collectServerInlayAssetRefs(args.currentChat)
  if (inlayAssetRefs.length > 0) {
    input.inlayAssetRefs = inlayAssetRefs
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
      targetCharacterId: args.currentChar.chaId,
      targetChatId: args.currentChat.id,
      currentChat: args.currentChat,
    })
    return { status: 'failed', error: served.error, currentChat }
  }

  args.stageTimings.stage1Duration =
    numberFrom(served.info?.timings?.prompt) ?? Date.now() - args.stageTimings.stage1Start

  if (args.preview || args.previewPrompt) {
    if (args.previewPrompt) {
      const promptText = served.prompt.promptInfo?.promptText
      return {
        status: 'preview',
        body: typeof promptText === 'string' ? promptText : JSON.stringify(Array.isArray(promptText) ? promptText : []),
      }
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
    targetCharacterId: args.currentChar.chaId,
    targetChatId: args.currentChat.id,
    currentChat: args.currentChat,
  })

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
    // Provider dispatch is server-owned on this branch. New servers omit the
    // potentially large prompt rows; retain the empty fallback for older call
    // sites whose common result type still includes `formated`.
    formated: served.prompt.formated ?? [],
    biases: served.prompt.biases ?? [],
    inputTokens: numberFrom(served.info?.tokens?.prompt) ?? numberFrom(served.prompt.promptInfo?.inputTokens) ?? 0,
    outputTokens:
      numberFrom(served.info?.responseBudget) ??
      numberFrom(served.prompt.promptInfo?.outputTokens) ??
      getDatabase().maxResponse,
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
    typeof args.regenerateMessageId === 'string' ? 'regenerate' : args.continue ? 'continue' : 'send'
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
      targetCharacterId: args.currentChar.chaId,
      targetChatId: args.currentChat.id,
      currentChat: args.currentChat,
    })
    return { status: 'failed', error: served.error, currentChat }
  }

  args.stageTimings.stage1Duration =
    numberFrom(served.info?.timings?.prompt) ?? Date.now() - args.stageTimings.stage1Start

  const currentChat = applyServerMessagePatches({
    patches: served.messagePatches,
    selectedChar: args.selectedChar,
    selectedChat: args.selectedChat,
    targetCharacterId: args.currentChar.chaId,
    targetChatId: args.currentChat.id,
    currentChat: args.currentChat,
  })

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
    formated: served.prompt.formated ?? [],
    biases: served.prompt.biases ?? [],
    inputTokens: numberFrom(served.info?.tokens?.prompt) ?? numberFrom(served.prompt.promptInfo?.inputTokens) ?? 0,
    outputTokens:
      numberFrom(served.info?.responseBudget) ??
      numberFrom(served.prompt.promptInfo?.outputTokens) ??
      getDatabase().maxResponse,
    ...(dispatch ? { dispatch } : {}),
  }
}

export async function applyServerBackedTerminal(args: {
  terminal: ServerChatTerminal
  currentChar: character
  currentChat: Chat
  selectedChar: number
  selectedChat: number
  targetCharacterId?: string
  targetChatId?: string
  generationInfo: MessageGenerationInfo
  /** Continue/regenerate target message id, so the post-gen final text + inlay land
   * on the right row when it is not keyed by `generationId` (the continue case). */
  targetMessageId?: string
}): Promise<ServerBackedTerminalResult> {
  const terminalInfo = args.terminal.done?.generationInfo
  if (terminalInfo && typeof terminalInfo === 'object') {
    Object.assign(args.generationInfo, terminalInfo)
  }
  const contextTarget = { characterId: args.targetCharacterId, chatId: args.targetChatId }
  if (args.terminal.status === 'error') {
    const target = targetFromPayloadOrContext(args.terminal.restoration, contextTarget)
    if (args.terminal.restoration) {
      withTrustedResourceWrite(() => {
        const resolution = resolveServerBackedLiveChat({
          selectedChar: args.selectedChar,
          selectedChat: args.selectedChat,
          characterId: target.characterId,
          chatId: target.chatId,
        })
        if (resolution) {
          applyServerChatRestoration(resolution.chat, args.terminal.restoration!)
        }
      })
    }
    return {
      status: 'failed',
      error: args.terminal.error ?? 'Server returned an error without details during generation.',
      currentChat: resolveServerBackedCurrentChat({
        selectedChar: args.selectedChar,
        selectedChat: args.selectedChat,
        characterId: target.characterId,
        chatId: target.chatId,
        currentChat: args.currentChat,
      }),
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
  const terminalTarget = targetFromPayloadOrContext(postGen?.messagePatch, contextTarget)
  type InlayFinalizationState = {
    messageId: string
    expectedServerData: string
    expectedProjectionData: string
    mutationIntentEpoch: number
    projectionEpoch: number
  }
  let immediateInlay: InlayFinalizationState | undefined
  let pendingInlay: (InlayFinalizationState & { promise: Promise<string> }) | undefined
  withTrustedResourceWrite(() => {
    const resolution = resolveServerBackedLiveChat({
      selectedChar: args.selectedChar,
      selectedChat: args.selectedChat,
      characterId: terminalTarget.characterId,
      chatId: terminalTarget.chatId,
    })
    if (!resolution) return
    const liveChat = resolution.chat
    if (postGen?.messagePatch) {
      applyServerMessagePatch(liveChat, postGen.messagePatch)
    }
    const assistant =
      findGeneratedAssistantMessage(liveChat, generationId) ??
      (args.targetMessageId
        ? liveChat.message.find((message) => message.chatId === args.targetMessageId && message.role === 'char')
        : undefined)
    if (assistant) {
      const baseText = typeof postGen?.finalText === 'string' ? postGen.finalText : assistant.data
      const inlay = runInlayScreen(resolution.character, baseText)
      assistant.data = inlay.text
      const messageId = assistant.chatId ?? args.targetMessageId ?? generationId
      if (inlay.text !== baseText && messageId && generationId) {
        const finalization = {
          messageId,
          expectedServerData: baseText,
          expectedProjectionData: inlay.text,
          mutationIntentEpoch: captureChatMessageMutationIntentEpoch(terminalTarget.chatId),
          projectionEpoch: captureChatBodyProjectionEpoch(terminalTarget.chatId),
        }
        if (inlay.promise) {
          pendingInlay = { ...finalization, promise: inlay.promise }
        } else {
          immediateInlay = finalization
        }
      }
    }
  })

  const settleInlayProjection = (finalization: InlayFinalizationState, finalData: string, persisted: boolean): void => {
    withTrustedResourceWrite(() => {
      if (captureChatMessageMutationIntentEpoch(terminalTarget.chatId) !== finalization.mutationIntentEpoch) {
        return
      }
      const resolution = resolveServerBackedLiveChat({
        selectedChar: args.selectedChar,
        selectedChat: args.selectedChat,
        characterId: terminalTarget.characterId,
        chatId: terminalTarget.chatId,
      })
      const assistant = resolution?.chat.message.find(
        (message) => message.chatId === finalization.messageId && message.role === 'char',
      )
      if (!assistant) return
      if (assistant.data !== finalization.expectedProjectionData && assistant.data !== finalData) return
      assistant.data = persisted ? finalData : finalization.expectedServerData
    })
  }

  if (immediateInlay) {
    const persisted = await finalizeServerBackedInlayMessage({
      chatId: terminalTarget.chatId,
      messageId: immediateInlay.messageId,
      generationId,
      expectedData: immediateInlay.expectedServerData,
      finalData: immediateInlay.expectedProjectionData,
    })
    settleInlayProjection(immediateInlay, immediateInlay.expectedProjectionData, persisted)
  }

  if (pendingInlay) {
    let resolved = ''
    let promiseFailed = false
    try {
      resolved = await pendingInlay.promise
    } catch {
      settleInlayProjection(pendingInlay, pendingInlay.expectedServerData, false)
      promiseFailed = true
    }
    let canFinalize = !promiseFailed
    withTrustedResourceWrite(() => {
      if (
        captureChatMessageMutationIntentEpoch(terminalTarget.chatId) !== pendingInlay!.mutationIntentEpoch ||
        hasChatBodyProjectionEpochChanged(terminalTarget.chatId, pendingInlay!.projectionEpoch)
      ) {
        canFinalize = false
        return
      }
      const resolution = resolveServerBackedLiveChat({
        selectedChar: args.selectedChar,
        selectedChat: args.selectedChat,
        characterId: terminalTarget.characterId,
        chatId: terminalTarget.chatId,
      })
      const liveChat = resolution?.chat
      const assistant = liveChat
        ? liveChat.message.find((message) => message.chatId === pendingInlay!.messageId && message.role === 'char')
        : undefined
      if (!assistant || assistant.data !== pendingInlay!.expectedProjectionData) canFinalize = false
    })
    if (canFinalize) {
      const persisted = await finalizeServerBackedInlayMessage({
        chatId: terminalTarget.chatId,
        messageId: pendingInlay.messageId,
        generationId,
        expectedData: pendingInlay.expectedServerData,
        finalData: resolved,
      })
      settleInlayProjection(pendingInlay, resolved, persisted)
    }
  }

  const providerAlternates = args.terminal.done?.alternates
  if (Array.isArray(providerAlternates) && providerAlternates.length > 0) {
    withTrustedResourceWrite(() => {
      const resolution = resolveServerBackedLiveChat({
        selectedChar: args.selectedChar,
        selectedChat: args.selectedChat,
        characterId: terminalTarget.characterId,
        chatId: terminalTarget.chatId,
      })
      const liveChat = resolution?.chat
      if (!liveChat) return
      const assistant =
        findGeneratedAssistantMessage(liveChat, generationId) ??
        (args.targetMessageId
          ? liveChat.message.find((message) => message.chatId === args.targetMessageId && message.role === 'char')
          : undefined)
      if (assistant) {
        const alternates = buildServerBackedAlternateMessages(assistant, providerAlternates, generationId)
        if (alternates.length === 0) return
        seedRerollBufferFromAlternates(
          liveChat.message,
          // Match persisted alternate-row ordering (newest-added first), including
          // the active primary candidate so it remains swipe index zero.
          [...alternates.reverse(), assistant],
        )
      }
    })
  }

  if (postGen?.agentPresetError) {
    return {
      status: 'failed',
      error: postGen.agentPresetError.message,
      currentChat: resolveServerBackedCurrentChat({
        selectedChar: args.selectedChar,
        selectedChat: args.selectedChat,
        characterId: terminalTarget.characterId,
        chatId: terminalTarget.chatId,
        currentChat: args.currentChat,
      }),
      resendChat: false,
    }
  }

  return {
    status: 'ok',
    currentChat: resolveServerBackedCurrentChat({
      selectedChar: args.selectedChar,
      selectedChat: args.selectedChat,
      characterId: terminalTarget.characterId,
      chatId: terminalTarget.chatId,
      currentChat: args.currentChat,
    }),
    resendChat,
  }
}
