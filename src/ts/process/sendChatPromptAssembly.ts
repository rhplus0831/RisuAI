import { language } from '../../lang'
import { type character, type Chat, type Database, type MessagePresetInfo } from '../storage/database.svelte'
import type { ChatTokenizer } from '../tokenizer'
import { findCharacterbyId } from '../characterState'
import { risuChatParser } from './scripts'
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
import { finalizeRequestBudget } from './promptBudget/finalizeRequestBudget'
import { withTrustedResourceWrite } from '../server/resourceWriteGuard.svelte'
import {
  currentPromptTemplateOwnerId,
  ensurePromptTemplateHydrated,
  isPromptTemplateHydrated,
} from '../server/promptTemplateHydration'
import type { OpenAIChat } from './index.svelte'
import { resolveModelProfile } from '../model/modelProfileResolver'

export interface SendChatPromptStageTimings {
  stage1Start: number
  stage1Duration: number
  stage2Start: number
  stage2Duration: number
}

export type LocalSendChatPromptResult =
  | { status: 'stopped' }
  | {
      status: 'assembled'
      currentChat: Chat
      formated: OpenAIChat[]
      biases: [string, number][]
      inputTokens: number
      outputTokens: number
    }

export function createSendChatCharacterCache(): (id: string) => character {
  const findCharCache: { [key: string]: character } = {}
  return (id: string) => {
    const cached = findCharCache[id]
    if (cached) return cached
    const found = findCharacterbyId(id)
    findCharCache[id] = found
    return found
  }
}

export function runSendChatMessageVariables(chat: Chat, currentChar: character): Chat {
  chat.message = chat.message.map((v) => {
    v.data = risuChatParser(v.data, { chara: currentChar, runVar: true })
    return v
  })
  return chat
}

function effectivePromptTemplateHydrationOwnerId(chat: Chat): string | null {
  const chatPromptPresetId = chat.generationSettings?.promptPresetId
  if (typeof chatPromptPresetId === 'string' && chatPromptPresetId.trim() !== '') {
    return chatPromptPresetId.trim()
  }
  return currentPromptTemplateOwnerId()
}

export async function assembleLocalSendChatPrompt(args: {
  currentChar: character
  currentChat: Chat
  database: Database
  nowChatroom: character
  selectedChar: number
  selectedChat: number
  tokenizer: ChatTokenizer
  promptInfo: MessagePresetInfo
  maxContextTokens: number
  stageTimings: SendChatPromptStageTimings
  isContinue: boolean
  findCharacterbyIdwithCache: (id: string) => character
  throwError: (error: string) => void
  setProcessStage: (stage: number) => void
}): Promise<LocalSendChatPromptResult> {
  const database = args.database
  let currentChat = args.currentChat
  withTrustedResourceWrite(() => {
    const liveChat = database.characters[args.selectedChar].chats[args.selectedChat]
    currentChat = runSendChatMessageVariables(liveChat, args.currentChar)
    database.characters[args.selectedChar].chats[args.selectedChat] = currentChat
  })
  currentChat = database.characters[args.selectedChar].chats[args.selectedChat]

  args.setProcessStage(1)
  args.stageTimings.stage1Start = Date.now()
  const unformated = {
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

  const promptTemplateOwnerId = effectivePromptTemplateHydrationOwnerId(currentChat)
  const promptTemplateHydrated = await ensurePromptTemplateHydrated({
    promptPresetId: promptTemplateOwnerId,
    applyProjection: false,
  })
  if (!promptTemplateHydrated && !isPromptTemplateHydrated(promptTemplateOwnerId)) {
    args.throwError(language.errors.promptTemplateUnavailable)
    return { status: 'stopped' }
  }
  const { promptTemplate, usingPromptTemplate } = normalizeTemplate(args.currentChar, {
    chatPromptPresetId: currentChat.generationSettings?.promptPresetId,
    db: database,
  })
  const mainProfile = resolveModelProfile({ database, role: 'chatMain' })
  const mainModelId = mainProfile.modelId
  const maxResponseTokens = mainProfile.runtimeOptions.maxResponse ?? database.maxResponse

  if (!args.currentChar.utilityBot && !promptTemplate) {
    const sections = buildPlainPromptSections(args.currentChar, database)
    unformated.main.push(...sections.main)
    unformated.jailbreak.push(...sections.jailbreak)
    unformated.globalNote.push(...sections.globalNote)
  }

  unformated.authorNote.push(...buildAuthorNote(args.currentChar, currentChat))
  unformated.postEverything.push(...buildCotInstruction(usingPromptTemplate, database))

  const descriptionBasePrompt = await buildDescription(args.currentChar, currentChat, database)
  unformated.description.push(descriptionBasePrompt)
  unformated.personaPrompt.push(...buildPersona(args.currentChar))
  unformated.postEverything.push(...buildInlayViewInstruction(args.currentChar))

  const lore = await buildLorebookContext(args.currentChar, unformated)
  const { resolvePosition, positionParser, depthPrompts } = lore
  const descriptionBaseIndex = unformated.description.indexOf(descriptionBasePrompt)

  let currentTokens = maxResponseTokens + 50

  const preflight = await preflightTemplateTokens(
    promptTemplate,
    usingPromptTemplate,
    unformated,
    args.tokenizer,
    args.currentChar,
    positionParser,
    database,
    descriptionBaseIndex,
  )
  currentTokens += preflight.addedTokens

  const history = await buildHistoryWindow({
    currentChar: args.currentChar,
    currentChat,
    modelId: mainModelId,
    usingPromptTemplate,
    tokenizer: args.tokenizer,
    findCharacterbyIdwithCache: args.findCharacterbyIdwithCache,
    depthPrompts,
    resolvePosition,
    database,
  })
  if (history.stopSending === true) return { status: 'stopped' }
  currentTokens += history.addedTokens
  currentChat = history.currentChat

  const memWindow = await buildMemoryWindow({
    chats: history.chats,
    currentTokens,
    maxContextTokens: args.maxContextTokens,
    currentChat,
    nowChatroom: args.nowChatroom,
    tokenizer: args.tokenizer,
    selectedChar: args.selectedChar,
    selectedChat: args.selectedChat,
    memoryCardUsed: preflight.memoryCardUsed,
    promptTemplate,
    unformated,
    stageTimings: args.stageTimings,
    throwError: args.throwError,
    setProcessStage: args.setProcessStage,
    database,
  })
  if (memWindow.stopSending === true) return { status: 'stopped' }
  currentChat = memWindow.currentChat

  const biases = database.bias.concat(args.currentChar.bias).map((v) => {
    return [
      risuChatParser(v[0].replaceAll('\\n', '\n').replaceAll('\\r', '\r').replaceAll('\\\\', '\\'), {
        chara: args.currentChar,
      }),
      v[1],
    ] as [string, number]
  })

  for (const depthPrompt of depthPrompts) {
    const chat: OpenAIChat = {
      role: depthPrompt.role,
      content: risuChatParser(resolvePosition(depthPrompt.prompt), { chara: args.currentChar }),
    }
    const depth = depthPrompt.pos === 'depth' ? depthPrompt.depth : unformated.chats.length - depthPrompt.depth
    unformated.chats.splice(depth, 0, chat)
  }

  const triggerResult = history.triggerResult
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

  const formatOrder = safeStructuredClone(database.formatingOrder)
  if (formatOrder) {
    formatOrder.push('postEverything')
  }

  const render = await renderFinalPrompt({
    currentChar: args.currentChar,
    database,
    modelId: mainModelId,
    unformated,
    promptTemplate,
    usingPromptTemplate,
    formatOrder: formatOrder ?? [],
    memories: memWindow.memories,
    positionParser,
    hasCachePoint: preflight.hasCachePoint,
    isContinue: args.isContinue,
    descriptionBaseIndex,
  })
  if (render.promptText) {
    args.promptInfo.promptText = render.promptText
  }

  const budget = await finalizeRequestBudget(render.formated, args.maxContextTokens, maxResponseTokens, args.tokenizer)
  if (!budget.ok) {
    args.throwError(language.errors.toomuchtoken + '\n\nAt token rechecking. Required Tokens: ' + budget.inputTokens)
    return { status: 'stopped' }
  }

  return {
    status: 'assembled',
    currentChat,
    formated: budget.formated,
    biases,
    inputTokens: budget.inputTokens,
    outputTokens: budget.outputTokens,
  }
}
