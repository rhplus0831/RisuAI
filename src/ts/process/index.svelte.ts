import { get, writable } from 'svelte/store'
import {
  type character,
  type MessageGenerationInfo,
  type Chat,
  type MessagePresetInfo,
  changeToPreset,
} from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { selectedCharID } from '../stores.svelte'
import { ChatTokenizer } from '../tokenizer'
import { language } from '../../lang'
import { alertError, alertToast } from '../alert'
import {
  findCharacterbyId,
  trimUntilPunctuation,
  parseToggleSyntax,
} from '../util'
import { requestChatData } from './request/request'
import { risuChatParser } from './scripts'
import { sayTTS } from './tts'
import { v4 } from 'uuid'
import { getGenerationModelString } from './models/modelString'
import { runInlayScreen } from './inlayScreen'
import { addRerolls } from './prereroll'
import { getModelInfo, LLMFlags } from '../model/modellist'
import { getModuleToggles } from './modules'
import { evaluateAutoContinue } from './autoContinue'
import { reportSendChatError } from './sendChatErrors'
import { fireDesktopNotification } from './postGeneration/notification'
import { evaluateIgp } from './postGeneration/igp'
import { finalizeStage4 } from './postGeneration/stage4Finalize'
import { applyEmotionFromResponse } from './postGeneration/emotionFromResponse'
import { runImggenStableDiff } from './postGeneration/imggenStableDiff'
import { runEmotionLlmFallback } from './postGeneration/emotionFallbackLlm'
import { runEmotionEmbeddingFallback } from './postGeneration/emotionFallbackEmbedding'
import { loadAndTrimCharEmotion } from './postGeneration/charEmotionStore'
import { applyOutputTrigger } from './postGeneration/outputTrigger'
import { applyNonStreamResponse } from './postGeneration/nonStreamResponse'
import { consumeStreamResponse } from './postGeneration/streamResponse'
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
  if (chatProcessIndex === -1 && DBState.db.presetChain) {
    const names = DBState.db.presetChain.split(',').map((v) => v.trim())
    const randomSelect = Math.floor(Math.random() * names.length)
    const ele = names[randomSelect]

    const findId = DBState.db.botPresets.findIndex((v) => {
      return v.name === ele
    })

    if (findId === -1) {
      alertToast(`Cannot find preset: ${ele}`)
    } else {
      changeToPreset(findId, true)
    }
  }

  DBState.db.statics.messages += 1
  selectedChar = get(selectedCharID)
  const nowChatroom = DBState.db.characters[selectedChar]
  nowChatroom.lastInteraction = Date.now()
  selectedChat = nowChatroom.chatPage
  nowChatroom.chats[nowChatroom.chatPage].message = nowChatroom.chats[
    nowChatroom.chatPage
  ].message.map((v) => {
    v.chatId = v.chatId ?? v4()
    return v
  })

  let promptInfo: MessagePresetInfo = {}
  let initialPresetNameForPromptInfo = null
  let initialPromptTogglesForPromptInfo: {
    key: string
    value: string
  }[] = []
  if (DBState.db.promptInfoInsideChat) {
    initialPresetNameForPromptInfo = DBState.db.botPresets[DBState.db.botPresetsId]?.name ?? ''
    initialPromptTogglesForPromptInfo = parseToggleSyntax(
      DBState.db.customPromptTemplateToggle + getModuleToggles(),
    ).flatMap((toggle) => {
      const raw = DBState.db.globalChatVariables[`toggle_${toggle.key}`]
      if (toggle.type === 'select' || toggle.type === 'text') {
        return [{ key: toggle.value, value: toggle.options[raw] }]
      }
      if (raw === '1') {
        return [{ key: toggle.value, value: 'ON' }]
      }
      return []
    })

    promptInfo = {
      promptName: initialPresetNameForPromptInfo,
      promptToggles: initialPromptTogglesForPromptInfo,
    }
  }

  let caculatedChatTokens = 0
  if (DBState.db.aiModel.startsWith('gpt')) {
    caculatedChatTokens += 5
  } else {
    caculatedChatTokens += 3
  }

  currentChar = nowChatroom

  let chatAdditonalTokens = arg.chatAdditonalTokens ?? caculatedChatTokens
  const tokenizer = new ChatTokenizer(
    chatAdditonalTokens,
    DBState.db.aiModel.startsWith('gpt') ? 'noName' : 'name',
  )
  let currentChat = runCurrentChatFunction(nowChatroom.chats[selectedChat])
  nowChatroom.chats[selectedChat] = currentChat
  let maxContextTokens = DBState.db.maxContext

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
  const generationId = v4()
  const generationModel = getGenerationModelString()

  generationInfo = {
    model: generationModel,
    generationId: generationId,
    inputTokens: inputTokens,
    outputTokens: outputTokens,
    maxContext: maxContextTokens,
    stageTiming: {
      stage1: stageTimings.stage1Duration,
      stage2: stageTimings.stage2Duration,
      stage3: 0,
      stage4: 0,
    },
  }

  chatProcessStage.set(3)
  stageTimings.stage3Start = Date.now()
  if (arg.preview) {
    previewFormated = formated
    return true
  }

  const req = await requestChatData(
    {
      formated: formated,
      biasString: biases,
      currentChar: currentChar,
      useStreaming: true,
      isGroupChat: false,
      bias: {},
      continue: arg.continue,
      chatId: generationId,
      imageResponse: DBState.db.outputImageModal,
      previewBody: arg.previewPrompt,
      escape: nowChatroom.type === 'character' && nowChatroom.escapeOutput,
      rememberToolUsage: DBState.db.rememberToolUsage,
    },
    'model',
    abortSignal,
  )

  console.log(req)
  if (req.model) {
    generationInfo.model = getGenerationModelString(req.model)
    console.log(generationInfo.model, req.model)
  }

  if (arg.previewPrompt && req.type === 'success') {
    previewBody = req.result
    return true
  }

  let result = ''
  let emoChanged = false
  let resendChat = false

  if (abortSignal.aborted === true) {
    return false
  }
  if (req.type === 'fail') {
    throwError(req.result)
    return false
  } else if (req.type === 'streaming') {
    const stream = await consumeStreamResponse({
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
    })
    result = stream.result
    emoChanged = stream.emoChanged

    if (stream.streamAborted || abortSignal.aborted) {
      return false
    }

    addRerolls(generationId, Object.values(stream.lastResponseChunk))

    const streamTrigger = await applyOutputTrigger({
      currentChar,
      selectedChar,
      selectedChat,
      runCurrentChatFunction,
    })
    currentChat = streamTrigger.triggerChat ?? streamTrigger.chat
    if (streamTrigger.resendChat) {
      resendChat = true
    }
    const inlayr = runInlayScreen(currentChar, currentChat.message[stream.msgIndex].data)
    currentChat.message[stream.msgIndex].data = inlayr.text
    DBState.db.characters[selectedChar].chats[selectedChat] = currentChat
    if (inlayr.promise) {
      const t = await inlayr.promise
      currentChat.message[stream.msgIndex].data = t
      DBState.db.characters[selectedChar].chats[selectedChat] = currentChat
    }
    if (DBState.db.ttsAutoSpeech) {
      await sayTTS(currentChar, result)
    }
  } else {
    const nonStream = await applyNonStreamResponse({
      req,
      arg,
      nowChatroom,
      currentChar,
      selectedChar,
      selectedChat,
      generationId,
      generationInfo,
      promptInfo,
      reformatContent,
    })
    result = nonStream.result
    emoChanged = nonStream.emoChanged
    if (nonStream.mrerolls.length > 1) {
      addRerolls(generationId, nonStream.mrerolls)
    }

    const nonStreamTrigger = await applyOutputTrigger({
      currentChar,
      selectedChar,
      selectedChat,
      runCurrentChatFunction,
    })
    if (nonStreamTrigger.triggerChat) {
      DBState.db.characters[selectedChar].chats[selectedChat] = nonStreamTrigger.triggerChat
    }
    if (nonStreamTrigger.resendChat) {
      resendChat = true
    }
  }

  const { shouldContinue, resultTokens } = await evaluateAutoContinue({
    result,
    usedContinueTokens: arg.usedContinueTokens || 0,
    db: DBState.db,
  })

  if (shouldContinue) {
    // Handoff — see iOwnDoingChat contract above.
    doingChat.set(false)
    iOwnDoingChat = false
    return await sendChat(chatProcessIndex, {
      chatAdditonalTokens: arg.chatAdditonalTokens,
      continue: true,
      signal: abortSignal,
      usedContinueTokens: resultTokens,
    })
  }

  await evaluateIgp({
    promptTemplate: DBState.db.igpPrompt ?? '',
    abortSignal,
    selectedChar,
    selectedChat,
  })

  stageTimings.stage3Duration = Date.now() - stageTimings.stage3Start

  if (generationInfo.stageTiming) {
    generationInfo.stageTiming.stage3 = stageTimings.stage3Duration
  }
  chatProcessStage.set(4)
  stageTimings.stage4Start = Date.now()

  if (resendChat) {
    finalizeStage4({ stageTimings, generationInfo, selectedChar, selectedChat })
    // Handoff — see iOwnDoingChat contract above.
    doingChat.set(false)
    iOwnDoingChat = false
    return await sendChat(chatProcessIndex, {
      signal: abortSignal,
    })
  }

  if (DBState.db.notification) {
    await fireDesktopNotification(result)
  }

  if (
    req.special &&
    applyEmotionFromResponse({ emotion: req.special.emotion, currentChar })
  ) {
    emoChanged = true
  }

  if (!currentChar.inlayViewScreen) {
    if (currentChar.viewScreen === 'emotion' && !emoChanged && abortSignal.aborted === false) {
      const { tempEmotion, charemotions } = loadAndTrimCharEmotion(currentChar.chaId)

      if (DBState.db.emotionProcesser === 'embedding') {
        await runEmotionEmbeddingFallback({
          result,
          currentChar,
          tempEmotion,
          charemotions,
        })
        return true
      }

      await runEmotionLlmFallback({
        result,
        currentChar,
        abortSignal,
        throwError,
        emotionPrompt2: DBState.db.emotionPrompt2,
        tempEmotion,
        charemotions,
      })
      return true
    } else if (currentChar.viewScreen === 'imggen') {
      await runImggenStableDiff({ currentChar, selectedChar, selectedChat })
    }
  }

  finalizeStage4({ stageTimings, generationInfo, selectedChar, selectedChat })
  return true
  } finally {
    if (iOwnDoingChat) {
      doingChat.set(false)
    }
  }
}

