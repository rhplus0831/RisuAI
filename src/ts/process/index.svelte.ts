import { get, writable } from 'svelte/store'
import {
  type character,
  type MessageGenerationInfo,
  type Chat,
} from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { language } from '../../lang'
import { alertError } from '../alert'
import { findCharacterbyId, trimUntilPunctuation } from '../util'
import { risuChatParser } from './scripts'
import { getModelInfo, LLMFlags } from '../model/modellist'
import { reportSendChatError } from './sendChatErrors'
import { setupSendChatContext } from './sendChatContext'
import { orchestrateResponse } from './postGeneration/orchestrateResponse'
import { runStage4 } from './postGeneration/runStage4'
import { finalizeRequestBudget } from './promptBudget/finalizeRequestBudget'
import { buildDescription } from './promptAssembly/buildDescription'
import { buildPlainPromptSections } from './promptAssembly/buildPlainPromptSections'
import { normalizeTemplate } from './promptAssembly/normalizeTemplate'
import {
  buildAuthorNote,
  buildCotInstruction,
  buildInlayViewInstruction,
  buildPersona,
} from './promptAssembly/buildStaticPromptSections'
import { buildLorebookContext } from './promptAssembly/buildLorebookContext'
import { buildHistoryWindow } from './promptAssembly/buildHistoryWindow'
import { buildMemoryWindow } from './promptAssembly/buildMemoryWindow'
import { renderFinalPrompt } from './promptAssembly/renderFinalPrompt'
import { preflightTemplateTokens } from './promptBudget/preflightTemplateTokens'
import { dispatchRequest } from './dispatch/dispatchRequest'

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

  let isAborted = false
  let findCharCache: { [key: string]: character } = {}
  function findCharacterbyIdwithCache(id: string) {
    const d = findCharCache[id]
    if (!!d) {
      return d
    } else {
      const r = findCharacterbyId(id)
      findCharCache[id] = r
      return r
    }
  }

  function runCurrentChatFunction(chat: Chat) {
    chat.message = chat.message.map((v) => {
      v.data = risuChatParser(v.data, { chara: currentChar, runVar: true })
      return v
    })
    return chat
  }

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
  const ctx = setupSendChatContext({
    chatProcessIndex,
    chatAdditonalTokens: arg.chatAdditonalTokens,
  })
  selectedChar = ctx.selectedChar
  selectedChat = ctx.selectedChat
  const nowChatroom = ctx.nowChatroom
  let promptInfo = ctx.promptInfo
  const tokenizer = ctx.tokenizer
  const maxContextTokens = ctx.maxContextTokens

  currentChar = nowChatroom
  let currentChat = runCurrentChatFunction(nowChatroom.chats[selectedChat])
  nowChatroom.chats[selectedChat] = currentChat

  chatProcessStage.set(1)
  stageTimings.stage1Start = Date.now()
  let unformated = {
    main: [] as OpenAIChat[],
    jailbreak: [] as OpenAIChat[],
    chats: [] as OpenAIChat[],
    lorebook: [] as OpenAIChat[],
    globalNote: [] as OpenAIChat[],
    authorNote: [] as OpenAIChat[],
    lastChat: [] as OpenAIChat[],
    description: [] as OpenAIChat[],
    postEverything: [] as OpenAIChat[],
    personaPrompt: [] as OpenAIChat[],
  }

  let { promptTemplate, usingPromptTemplate } = normalizeTemplate(currentChar)

  if (!currentChar.utilityBot && !promptTemplate) {
    const sections = buildPlainPromptSections(currentChar)
    unformated.main.push(...sections.main)
    unformated.jailbreak.push(...sections.jailbreak)
    unformated.globalNote.push(...sections.globalNote)
  }

  unformated.authorNote.push(...buildAuthorNote(currentChar, currentChat))
  unformated.postEverything.push(...buildCotInstruction(usingPromptTemplate))

  unformated.description.push(await buildDescription(currentChar, currentChat))
  unformated.personaPrompt.push(...buildPersona(currentChar))
  unformated.postEverything.push(...buildInlayViewInstruction(currentChar))

  const lore = await buildLorebookContext(currentChar, unformated)
  const { resolvePosition, positionParser, depthPrompts } = lore

  //await tokenize currernt
  let currentTokens = DBState.db.maxResponse

  //for unexpected error
  currentTokens += 50

  const preflight = await preflightTemplateTokens(
    promptTemplate,
    usingPromptTemplate,
    unformated,
    tokenizer,
    currentChar,
    positionParser,
  )
  currentTokens += preflight.addedTokens
  const memoryCardUsed = preflight.memoryCardUsed
  let hasCachePoint = preflight.hasCachePoint

  const history = await buildHistoryWindow({
    currentChar,
    currentChat,
    usingPromptTemplate,
    tokenizer,
    findCharacterbyIdwithCache,
    depthPrompts,
    resolvePosition,
  })
  if (history.stopSending === true) {
    return false
  }
  let chats: OpenAIChat[] = history.chats
  currentTokens += history.addedTokens
  currentChat = history.currentChat
  const triggerResult = history.triggerResult

  const memWindow = await buildMemoryWindow({
    chats,
    currentTokens,
    maxContextTokens,
    currentChat,
    nowChatroom,
    tokenizer,
    selectedChar,
    selectedChat,
    memoryCardUsed,
    promptTemplate,
    unformated,
    stageTimings,
    throwError,
    setProcessStage: (stage) => chatProcessStage.set(stage),
  })
  if (memWindow.stopSending === true) {
    return false
  }
  chats = memWindow.chats
  currentTokens = memWindow.currentTokens
  currentChat = memWindow.currentChat
  const memories = memWindow.memories

  let biases: [string, number][] = DBState.db.bias.concat(currentChar.bias).map((v) => {
    return [
      risuChatParser(
        v[0].replaceAll('\\n', '\n').replaceAll('\\r', '\r').replaceAll('\\\\', '\\'),
        { chara: currentChar },
      ),
      v[1],
    ]
  })

  for (const depthPrompt of depthPrompts) {
    const chat: OpenAIChat = {
      role: depthPrompt.role,
      content: risuChatParser(resolvePosition(depthPrompt.prompt), { chara: currentChar }),
    }
    const depth =
      depthPrompt.pos === 'depth' ? depthPrompt.depth : unformated.chats.length - depthPrompt.depth
    unformated.chats.splice(depth, 0, chat)
  }

  if (triggerResult) {
    if (triggerResult.additonalSysPrompt.promptend) {
      unformated.postEverything.push({
        role: 'system',
        content: triggerResult.additonalSysPrompt.promptend,
      })
    }
    if (triggerResult.additonalSysPrompt.historyend) {
      unformated.lastChat.push({
        role: 'system',
        content: triggerResult.additonalSysPrompt.historyend,
      })
    }
    if (triggerResult.additonalSysPrompt.start) {
      unformated.lastChat.unshift({
        role: 'system',
        content: triggerResult.additonalSysPrompt.start,
      })
    }
  }

  //make into one

  const formatOrder = safeStructuredClone(DBState.db.formatingOrder)
  if (formatOrder) {
    formatOrder.push('postEverything')
  }

  const render = await renderFinalPrompt({
    currentChar,
    unformated,
    promptTemplate,
    usingPromptTemplate,
    formatOrder: formatOrder ?? [],
    memories,
    positionParser,
    hasCachePoint,
    isContinue: !!arg.continue,
  })
  let formated = render.formated
  if (render.promptText) {
    promptInfo.promptText = render.promptText
  }


  const budget = await finalizeRequestBudget(
    formated,
    maxContextTokens,
    DBState.db.maxResponse,
    tokenizer,
  )
  if (!budget.ok) {
    throwError(
      language.errors.toomuchtoken +
        '\n\nAt token rechecking. Required Tokens: ' +
        budget.inputTokens,
    )
    return false
  }
  formated = budget.formated
  const inputTokens = budget.inputTokens
  const outputTokens = budget.outputTokens

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
    setProcessStage: (stage) => chatProcessStage.set(stage),
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
  const req = dispatch.req
  const generationId = dispatch.generationId
  generationInfo = dispatch.generationInfo

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
    setProcessStage: (stage) => chatProcessStage.set(stage),
  })
  if (stage4.status === 'resend') {
    // Handoff — see iOwnDoingChat contract above.
    doingChat.set(false)
    iOwnDoingChat = false
    return await sendChat(chatProcessIndex, {
      signal: abortSignal,
    })
  }
  return true
  } finally {
    if (iOwnDoingChat) {
      doingChat.set(false)
    }
  }
}

