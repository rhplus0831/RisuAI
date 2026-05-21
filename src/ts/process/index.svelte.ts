import { get, writable } from 'svelte/store'
import {
  type character,
  type MessageGenerationInfo,
  type Chat,
  type MessagePresetInfo,
  changeToPreset,
  setCurrentChat,
  type Message,
} from '../storage/database.svelte'
import { DBState } from '../stores.svelte'
import { selectedCharID } from '../stores.svelte'
import { ChatTokenizer } from '../tokenizer'
import { language } from '../../lang'
import { alertError, alertToast } from '../alert'
import { parseChatML } from '../parser/chatML'
import { loadLoreBookV3Prompt } from './lorebook.svelte'
import {
  findCharacterbyId,
  getAuthorNoteDefaultText,
  getPersonaPrompt,
  getUserName,
  trimUntilPunctuation,
  parseToggleSyntax,
  prebuiltAssetCommand,
} from '../util'
import { requestChatData } from './request/request'
import { processScript, processScriptFull, risuChatParser } from './scripts'
import { exampleMessage } from './exampleMessages'
import { sayTTS } from './tts'
import { v4 } from 'uuid'
import { runTrigger } from './triggers'
import { additionalInformations } from './embedding/addinfo'
import { getInlayAsset } from './files/inlays'
import { getGenerationModelString } from './models/modelString'
import { runInlayScreen } from './inlayScreen'
import { addRerolls } from './prereroll'
import { runImageEmbedding } from './transformers'
import { runLuaEditTrigger } from './scriptings'
import { getModelInfo, LLMFlags } from '../model/modellist'
import { hypaMemoryV3 } from './memory/hypav3'
import { getModuleAssets, getModuleToggles } from './modules'
import { readImage } from '../globalApi.svelte'
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

  let promptTemplate = safeStructuredClone(DBState.db.promptTemplate)
  const usingPromptTemplate = !!promptTemplate
  if (promptTemplate) {
    let hasPostEverything = false
    for (const card of promptTemplate) {
      if (card.type === 'postEverything') {
        hasPostEverything = true
        break
      }
    }

    if (!hasPostEverything) {
      promptTemplate.push({
        type: 'postEverything',
      })
    }
  }
  if (currentChar.utilityBot && !(usingPromptTemplate && DBState.db.promptSettings.utilOverride)) {
    promptTemplate = [
      {
        type: 'plain',
        text: '',
        role: 'system',
        type2: 'main',
      },
      {
        type: 'description',
      },
      {
        type: 'lorebook',
      },
      {
        type: 'chat',
        rangeStart: 0,
        rangeEnd: 'end',
      },
      {
        type: 'plain',
        text: '',
        role: 'system',
        type2: 'globalNote',
      },
      {
        type: 'postEverything',
      },
    ]
  }

  if (!currentChar.utilityBot && !promptTemplate) {
    const mainp =
      currentChar.systemPrompt?.replaceAll('{{original}}', DBState.db.mainPrompt) ||
      DBState.db.mainPrompt

    function formatPrompt(data: string) {
      if (!data.startsWith('@@')) {
        data = '@@system\n' + data
      }
      const parts = data.split(/@@@?(user|assistant|system)\n/)

      // Initialize empty array for the chat objects
      const chatObjects: OpenAIChat[] = []

      // Loop through the parts array two elements at a time
      for (let i = 1; i < parts.length; i += 2) {
        const role = parts[i] as 'user' | 'assistant' | 'system'
        const content = parts[i + 1]?.trim() || ''
        chatObjects.push({ role, content })
      }

      return chatObjects
    }

    unformated.main.push(
      ...formatPrompt(
        risuChatParser(
          mainp +
            (DBState.db.additionalPrompt === '' || !DBState.db.promptPreprocess
              ? ''
              : `\n${DBState.db.additionalPrompt}`),
          { chara: currentChar },
        ),
      ),
    )

    if (DBState.db.jailbreakToggle) {
      unformated.jailbreak.push(
        ...formatPrompt(risuChatParser(DBState.db.jailbreak, { chara: currentChar })),
      )
    }

    unformated.globalNote.push(
      ...formatPrompt(
        risuChatParser(
          currentChar.replaceGlobalNote?.replaceAll('{{original}}', DBState.db.globalNote) ||
            DBState.db.globalNote,
          { chara: currentChar },
        ),
      ),
    )
  }

  if (currentChat.note) {
    unformated.authorNote.push({
      role: 'system',
      content: risuChatParser(currentChat.note, { chara: currentChar }),
    })
  } else if (getAuthorNoteDefaultText() !== '') {
    unformated.authorNote.push({
      role: 'system',
      content: risuChatParser(getAuthorNoteDefaultText(), { chara: currentChar }),
    })
  }

  if (
    DBState.db.chainOfThought &&
    !(usingPromptTemplate && DBState.db.promptSettings.customChainOfThought)
  ) {
    unformated.postEverything.push({
      role: 'system',
      content: `<instruction> - before respond everything, Think step by step as a ai assistant how would you respond inside <Thoughts> xml tag. this must be less than 5 paragraphs.</instruction>`,
    })
  }

  {
    let description = risuChatParser(
      (DBState.db.promptPreprocess ? DBState.db.descriptionPrefix : '') + currentChar.desc,
      { chara: currentChar },
    )

    const additionalInfo = await additionalInformations(currentChar, currentChat)

    if (additionalInfo) {
      description += '\n\n' + risuChatParser(additionalInfo, { chara: currentChar })
    }

    if (currentChar.personality) {
      description += risuChatParser('\n\nDescription of {{char}}: ' + currentChar.personality, {
        chara: currentChar,
      })
    }

    if (currentChar.scenario) {
      description += risuChatParser(
        '\n\nCircumstances and context of the dialogue: ' + currentChar.scenario,
        { chara: currentChar },
      )
    }

    unformated.description.push({
      role: 'system',
      content: description,
    })
  }

  const lorepmt = await loadLoreBookV3Prompt()

  const positionRegex = /{{position::(.+?)}}/g
  const replaceposition = (text: string): { text: string; replaced: boolean } => {
    let replaced = false
    const result = text.replace(positionRegex, (match, p1) => {
      replaced = true
      const posMatch = 'pt_' + p1
      const matchingPrompts: string[] = []
      for (const v of lorepmt.actives) {
        if (v.pos === posMatch) {
          matchingPrompts.push(v.prompt)
        }
      }
      return matchingPrompts.join('\n')
    })
    return { text: result, replaced }
  }

  // maxDepth controls how many levels of nesting are resolved. Currently set to 5, adjust if needed.
  const resolvePosition = (text: string, maxDepth: number = 5) => {
    let result = text
    for (let i = 0; i < maxDepth; i++) {
      const r = replaceposition(result)
      result = r.text
      if (!r.replaced) break
    }
    result = result.replace(positionRegex, '')
    return result
  }

  const normalActives = lorepmt.actives.filter((v) => {
    return v.pos === '' && v.inject === null
  })
  console.log(normalActives)

  for (const lorebook of normalActives) {
    unformated.lorebook.push({
      role: lorebook.role,
      content: risuChatParser(resolvePosition(lorebook.prompt), { chara: currentChar }),
    })
  }

  const descActives = lorepmt.actives.filter((v) => {
    return (
      v.pos === 'after_desc' ||
      v.pos === 'before_desc' ||
      v.pos === 'personality' ||
      v.pos === 'scenario'
    )
  })

  for (const lorebook of descActives) {
    const c = {
      role: lorebook.role,
      content: risuChatParser(resolvePosition(lorebook.prompt), { chara: currentChar }),
    }
    if (lorebook.pos === 'before_desc') {
      unformated.description.unshift(c)
    } else {
      unformated.description.push(c)
    }
  }

  if (DBState.db.personaPrompt) {
    unformated.personaPrompt.push({
      role: 'system',
      content: risuChatParser(getPersonaPrompt(), { chara: currentChar }),
    })
  }

  if (currentChar.inlayViewScreen) {
    if (currentChar.viewScreen === 'emotion') {
      unformated.postEverything.push({
        role: 'system',
        content: currentChar.newGenData.emotionInstructions.replaceAll(
          '{{slot}}',
          currentChar.emotionImages.map((v) => v[0]).join(', '),
        ),
      })
    }
    if (currentChar.viewScreen === 'imggen') {
      unformated.postEverything.push({
        role: 'system',
        content: currentChar.newGenData.instructions,
      })
    }
  }

  const postEverythingLorebooks = lorepmt.actives.filter((v) => {
    return v.pos === 'depth' && v.depth === 0 && v.role !== 'assistant'
  })
  for (const lorebook of postEverythingLorebooks) {
    unformated.postEverything.push({
      role: lorebook.role,
      content: risuChatParser(resolvePosition(lorebook.prompt), { chara: currentChar }),
    })
  }

  //Since assistant needs to be prefill, we need to add assistant lorebooks after user/system lorebooks
  const postEverythingAssistantLorebooks = lorepmt.actives.filter((v) => {
    return v.pos === 'depth' && v.depth === 0 && v.role === 'assistant'
  })

  const injectionLorebooks = lorepmt.actives.filter((v) => {
    return v.inject && !v.inject.lore
  })

  const injectionLorePosSet = new Set<string>()
  for (const lorebook of injectionLorebooks) {
    injectionLorePosSet.add(lorebook.inject.location)
  }

  for (const lorebook of postEverythingAssistantLorebooks) {
    unformated.postEverything.push({
      role: lorebook.role,
      content: risuChatParser(resolvePosition(lorebook.prompt), { chara: currentChar }),
    })
  }

  //await tokenize currernt
  let currentTokens = DBState.db.maxResponse
  let memoryCardUsed = false

  //for unexpected error
  currentTokens += 50

  const positionParser = (text: string, loc: string) => {
    console.log(injectionLorePosSet)
    if (injectionLorePosSet.has(loc)) {
      const matchings = injectionLorebooks.filter((v) => {
        return v.inject.location === loc
      })
      for (const lore of matchings) {
        switch (lore.inject.operation) {
          case 'append': {
            text += ' ' + lore.prompt
            break
          }
          case 'prepend': {
            text = lore.prompt + ' ' + text
            break
          }
          case 'replace': {
            text = text.replace(lore.inject.param, lore.prompt)
            break
          }
        }
      }
    }

    return resolvePosition(text)
  }

  let hasCachePoint = false
  if (promptTemplate) {
    const template = promptTemplate

    async function tokenizeChatArray(chats: OpenAIChat[]) {
      for (const chat of chats) {
        const tokens = await tokenizer.tokenizeChat(chat)
        currentTokens += tokens
      }
    }

    for (const card of template) {
      switch (card.type) {
        case 'persona': {
          let pmt = safeStructuredClone(unformated.personaPrompt)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
                chara: currentChar,
              }).replace('{{slot}}', pmt[i].content)
            }
          }

          await tokenizeChatArray(pmt)
          break
        }
        case 'description': {
          let pmt = safeStructuredClone(unformated.description)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
                chara: currentChar,
              }).replace('{{slot}}', pmt[i].content)
            }
          }

          await tokenizeChatArray(pmt)
          break
        }
        case 'authornote': {
          let pmt = safeStructuredClone(unformated.authorNote)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
                chara: currentChar,
              }).replace('{{slot}}', pmt[i].content || card.defaultText || '')
            }
          }

          await tokenizeChatArray(pmt)
          break
        }
        case 'lorebook': {
          await tokenizeChatArray(unformated.lorebook)
          break
        }
        case 'postEverything': {
          await tokenizeChatArray(unformated.postEverything)
          if (usingPromptTemplate && DBState.db.promptSettings.postEndInnerFormat) {
            await tokenizeChatArray([
              {
                role: 'system',
                content: DBState.db.promptSettings.postEndInnerFormat,
              },
            ])
          }
          break
        }
        case 'plain':
        case 'jailbreak':
        case 'cot': {
          if (!DBState.db.jailbreakToggle && card.type === 'jailbreak') {
            continue
          }
          if (!DBState.db.chainOfThought && card.type === 'cot') {
            continue
          }

          const convertRole = {
            system: 'system',
            user: 'user',
            bot: 'assistant',
          } as const

          const posType = card.type === 'plain' ? card.type2 : card.type
          let content = positionParser(card.text, posType)

          if (card.type2 === 'globalNote') {
            if (currentChar.replaceGlobalNote) {
              content = positionParser(currentChar.replaceGlobalNote, posType).replaceAll(
                '{{original}}',
                content,
              )
            }

            if (
              currentChar.prebuiltAssetCommand &&
              !card.text.includes('{{//@customimageinstruction}}')
            ) {
              content += prebuiltAssetCommand
            }
            content = risuChatParser(content, { chara: currentChar, role: card.role })
          } else if (card.type2 === 'main') {
            content = risuChatParser(content, { chara: currentChar, role: card.role })
          } else {
            content = risuChatParser(content, { chara: currentChar, role: card.role })
          }

          const prompt: OpenAIChat = {
            role: convertRole[card.role],
            content: content,
          }

          await tokenizeChatArray([prompt])
          break
        }
        case 'chatML': {
          let prompts = parseChatML(card.text)
          await tokenizeChatArray(prompts)
          break
        }
        case 'chat': {
          let start = card.rangeStart
          let end = card.rangeEnd === 'end' ? unformated.chats.length : card.rangeEnd
          if (start === -1000) {
            start = 0
            end = unformated.chats.length
          }
          if (start < 0) {
            start = unformated.chats.length + start
            if (start < 0) {
              start = 0
            }
          }
          if (end < 0) {
            end = unformated.chats.length + end
            if (end < 0) {
              end = 0
            }
          }

          if (start >= end) {
            break
          }
          let chats = unformated.chats.slice(start, end)

          if (
            usingPromptTemplate &&
            DBState.db.promptSettings.sendChatAsSystem &&
            !card.chatAsOriginalOnSystem
          ) {
            chats = systemizeChat(chats)
          }
          await tokenizeChatArray(chats)
          break
        }
        case 'memory': {
          memoryCardUsed = true
          break
        }
        case 'cache': {
          hasCachePoint = true
          break
        }
      }
    }
  } else {
    for (const key in unformated) {
      const chats = unformated[key] as OpenAIChat[]
      for (const chat of chats) {
        currentTokens += await tokenizer.tokenizeChat(chat)
      }
    }
  }

  const examples = exampleMessage(currentChar, getUserName())

  for (const example of examples) {
    currentTokens += await tokenizer.tokenizeChat(example)
  }

  let chats: OpenAIChat[] = examples

  if (!DBState.db.aiModel.startsWith('novelai') && !DBState.db?.promptSettings?.trimStartNewChat) {
    chats.push({
      role: 'system',
      content: '[Start a new chat]',
      memo: 'NewChat',
    })
  }

  let msReseted = false
  const makeMs = (currentChat: Chat) => {
    let mss: Message[] = []
    msReseted = false
    for (let i = currentChat.message.length - 1; i >= 0; i--) {
      const d = currentChat.message[i]
      if (d.disabled === true) {
        continue
      }
      if (d.disabled === 'allBefore') {
        msReseted = true
        break
      }
      mss.unshift(d)
    }
    return mss
  }

  let ms: Message[] = makeMs(currentChat)

  if (!msReseted) {
    const firstMsg =
      currentChat.fmIndex === -1
        ? nowChatroom.firstMessage
        : nowChatroom.alternateGreetings[currentChat.fmIndex]

    const chat: OpenAIChat = {
      role: 'assistant',
      content: await processScript(
        nowChatroom,
        risuChatParser(firstMsg, { chara: currentChar }),
        'editprocess',
      ),
    }

    if (usingPromptTemplate && DBState.db.promptSettings.sendName) {
      chat.content = `${currentChar.name}: ${chat.content}`
      chat.attr = ['nameAdded']
    }
    chats.push(chat)
    currentTokens += await tokenizer.tokenizeChat(chat)
  }

  console.log('Prepared messages for token calculation:', ms)

  const triggerResult = await runTrigger(currentChar, 'start', { chat: currentChat })
  if (triggerResult) {
    currentChat = triggerResult.chat
    setCurrentChat(currentChat)
    ms = makeMs(currentChat)
    currentTokens += triggerResult.tokens
    if (triggerResult.stopSending) {
      return false
    }
  }

  let index = 0
  for (const msg of ms) {
    let formatedChat = (
      await processScriptFull(
        nowChatroom,
        risuChatParser(msg.data, { chara: currentChar, role: msg.role }),
        'editprocess',
        index,
        {
          chatRole: msg.role,
        },
      )
    ).data
    let name = ''
    if (msg.role === 'char') {
      if (msg.saying) {
        name = `${findCharacterbyIdwithCache(msg.saying).name}`
      } else {
        name = `${currentChar.name}`
      }
    } else if (msg.role === 'user') {
      name = `${getUserName()}`
    }
    if (!msg.chatId) {
      msg.chatId = v4()
    }
    let inlays: string[] = []
    if (msg.role === 'char') {
      formatedChat = formatedChat.replace(
        /{{(inlay|inlayed|inlayeddata)::(.+?)}}/g,
        (match: string, p1: string, p2: string) => {
          if (p2 && p1 === 'inlayeddata') {
            inlays.push(p2)
          }
          return ''
        },
      )
    } else {
      const inlayMatch = formatedChat.match(/{{(inlay|inlayed|inlayeddata)::(.+?)}}/g)
      if (inlayMatch) {
        for (const inlay of inlayMatch) {
          inlays.push(inlay)
        }
      }
    }

    let multimodal: MultiModal[] = []
    const modelinfo = getModelInfo(DBState.db.aiModel)
    if (inlays.length > 0) {
      for (const inlay of inlays) {
        const inlayName = inlay
          .replace('{{inlayed::', '')
          .replace('{{inlay::', '')
          .replace('}}', '')
          .replace('{{inlayeddata::', '')
        const inlayData = await getInlayAsset(inlayName)
        if (inlayData?.type === 'image') {
          if (modelinfo.flags.includes(LLMFlags.hasImageInput)) {
            multimodal.push({
              type: 'image',
              base64: inlayData.data,
              width: inlayData.width,
              height: inlayData.height,
            })
          } else {
            const captionResult = await runImageEmbedding(inlayData.data)
            formatedChat += `[${captionResult[0].generated_text}]`
          }
        }
        if (inlayData?.type === 'video' || inlayData?.type === 'audio') {
          if (multimodal.length === 0) {
            multimodal.push({
              type: inlayData.type,
              base64: inlayData.data,
            })
          }
        }
        if (inlayData?.type === 'signature') {
          multimodal.push({
            type: 'signature',
            base64: inlayData.data,
          })
        }
        formatedChat = formatedChat.replace(inlay, '')
      }
    }

    let attr: string[] = []
    let role: 'user' | 'assistant' | 'system' = msg.role === 'user' ? 'user' : 'assistant'

    if (usingPromptTemplate && DBState.db.promptSettings.sendName) {
      const form = `<{{char}}\'s Message>\n{{slot}}\n</{{char}}\'s Message>`
      formatedChat = risuChatParser(form, {
        chara: findCharacterbyIdwithCache(msg.saying).name,
      }).replace('{{slot}}', formatedChat)
    }
    let thoughts: string[] = []
    const maxThoughtDepth = DBState.db.promptSettings?.maxThoughtTagDepth ?? -1
    formatedChat = formatedChat.replace(/<Thoughts>(.+)<\/Thoughts>/gms, (match, p1) => {
      if (maxThoughtDepth === -1 || maxThoughtDepth - ms.length <= index) {
        thoughts.push(p1)
      }
      return ''
    })

    const assetPromises: Promise<void>[] = []
    formatedChat = formatedChat.replace(/\{\{asset_?prompt::(.+?)\}\}/gimsu, (match, p1) => {
      const moduleAssets = getModuleAssets()
      const assets = (currentChar.additionalAssets ?? []).concat(moduleAssets)
      const asset = assets.find((v) => {
        return v[0] === p1
      })
      if (asset) {
        assetPromises.push(
          (async () => {
            const assetDataBuf = await readImage(asset[1])
            multimodal.push({
              type: 'image',
              base64: `data:image/png;base64,${Buffer.from(assetDataBuf).toString('base64')}`,
            })
          })(),
        )
      } else if (p1 === 'icon') {
        assetPromises.push(
          (async () => {
            const assetDataBuf = await readImage(currentChar.image ?? '')
            multimodal.push({
              type: 'image',
              base64: `data:image/png;base64,${Buffer.from(assetDataBuf).toString('base64')}`,
            })
          })(),
        )
      }
      return ''
    })
    await Promise.all(assetPromises)

    const chat: OpenAIChat = {
      role: role,
      content: formatedChat,
      memo: msg.chatId,
      attr: attr,
      multimodals: multimodal,
      thoughts: thoughts,
    }
    if (chat.multimodals.length === 0) {
      delete chat.multimodals
    }
    chats.push(chat)
    currentTokens += await tokenizer.tokenizeChat(chat)
    index++
  }
  console.log(JSON.stringify(chats, null, 2))

  const depthPrompts = lorepmt.actives.filter((v) => {
    return (v.pos === 'depth' && v.depth > 0) || v.pos === 'reverse_depth'
  })

  for (const depthPrompt of depthPrompts) {
    const chat: OpenAIChat = {
      role: depthPrompt.role,
      content: risuChatParser(resolvePosition(depthPrompt.prompt), { chara: currentChar }),
    }
    currentTokens += await tokenizer.tokenizeChat(chat)
  }

  if (nowChatroom.supaMemory && DBState.db.hypaV3) {
    stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
    chatProcessStage.set(2)
    stageTimings.stage2Start = Date.now()
    console.log("Current chat's hypaV3 Data: ", currentChat.hypaV3Data)
    const sp = await hypaMemoryV3(
      chats,
      currentTokens,
      maxContextTokens,
      currentChat,
      nowChatroom,
      tokenizer,
    )
    if (sp.error) {
      // Save new summary
      if (sp.memory) {
        currentChat.hypaV3Data = sp.memory
        DBState.db.characters[selectedChar].chats[selectedChat].hypaV3Data = currentChat.hypaV3Data
      }
      console.log(sp)
      throwError(sp.error)
      return false
    }
    chats = sp.chats
    currentTokens = sp.currentTokens
    currentChat.hypaV3Data = sp.memory ?? currentChat.hypaV3Data
    DBState.db.characters[selectedChar].chats[selectedChat].hypaV3Data = currentChat.hypaV3Data

    currentChat = DBState.db.characters[selectedChar].chats[selectedChat]
    console.log("[Expected to be updated] chat's HypaV3Data: ", currentChat.hypaV3Data)
    stageTimings.stage2Duration = Date.now() - stageTimings.stage2Start
    chatProcessStage.set(1)
  } else {
    stageTimings.stage1Duration = Date.now() - stageTimings.stage1Start
    while (currentTokens > maxContextTokens) {
      if (chats.length <= 1) {
        throwError(language.errors.toomuchtoken + '\n\nRequired Tokens: ' + currentTokens)

        return false
      }

      currentTokens -= await tokenizer.tokenizeChat(chats[0])
      chats.splice(0, 1)
    }
    currentChat.lastMemory = chats[0].memo
  }

  let biases: [string, number][] = DBState.db.bias.concat(currentChar.bias).map((v) => {
    return [
      risuChatParser(
        v[0].replaceAll('\\n', '\n').replaceAll('\\r', '\r').replaceAll('\\\\', '\\'),
        { chara: currentChar },
      ),
      v[1],
    ]
  })

  let memories: OpenAIChat[] = []

  if (!promptTemplate) {
    unformated.lastChat.push(chats[chats.length - 1])
    chats.splice(chats.length - 1, 1)
  }

  unformated.chats = chats
    .map((v) => {
      if (v.memo !== 'supaMemory' && v.memo !== 'hypaMemory') {
        v.removable = true
      } else if (memoryCardUsed) {
        memories.push(v)
        return {
          role: 'system',
          content: '',
        } as OpenAIChat
      } else {
        v.content = `<Previous Conversation>${v.content}</Previous Conversation>`
      }
      return v
    })
    .filter((v) => {
      return v.content.trim() !== '' || (v.multimodals && v.multimodals.length > 0)
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

  let formated: OpenAIChat[] = []
  const formatOrder = safeStructuredClone(DBState.db.formatingOrder)
  if (formatOrder) {
    formatOrder.push('postEverything')
  }

  //continue chat model
  if (
    arg.continue &&
    (DBState.db.aiModel.startsWith('claude') ||
      DBState.db.aiModel.startsWith('gpt') ||
      DBState.db.aiModel.startsWith('openrouter') ||
      DBState.db.aiModel.startsWith('reverse_proxy'))
  ) {
    unformated.postEverything.push({
      role: 'system',
      content: '[Continue the last response]',
    })
  }

  function pushPrompts(cha: OpenAIChat[]) {
    for (const chat of cha) {
      if (!chat.content.trim() && !(chat.multimodals && chat.multimodals.length > 0)) {
        continue
      }
      if (
        !(
          DBState.db.aiModel.startsWith('gpt') ||
          DBState.db.aiModel.startsWith('claude') ||
          DBState.db.aiModel === 'openrouter' ||
          DBState.db.aiModel === 'reverse_proxy'
        )
      ) {
        formated.push(chat)
        continue
      }
      if (chat.role === 'system') {
        const endf = formated.at(-1)
        if (endf && endf.role === 'system' && endf.memo === chat.memo && endf.name === chat.name) {
          formated[formated.length - 1].content += '\n\n' + chat.content
        } else {
          formated.push(chat)
        }
        formated.at(-1).content += ''
      } else {
        formated.push(chat)
      }
    }
  }

  let promptBodyformatedForChatStore: OpenAIChat[] = []
  function pushPromptInfoBody(
    role: 'function' | 'system' | 'user' | 'assistant',
    fmt: string,
    promptBody: OpenAIChat[],
  ) {
    if (!fmt.trim()) {
      return
    }
    promptBody.push({
      role: role,
      content: risuChatParser(fmt),
    })
  }

  if (promptTemplate) {
    const template = promptTemplate

    for (const card of template) {
      switch (card.type) {
        case 'persona': {
          let pmt = safeStructuredClone(unformated.personaPrompt)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
                chara: currentChar,
              }).replace('{{slot}}', pmt[i].content)

              if (DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat) {
                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
              }
            }
          }

          pushPrompts(pmt)
          break
        }
        case 'description': {
          let pmt = safeStructuredClone(unformated.description)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
                chara: currentChar,
              }).replace('{{slot}}', pmt[i].content)

              if (DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat) {
                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
              }
            }
          }

          pushPrompts(pmt)
          break
        }
        case 'authornote': {
          let pmt = safeStructuredClone(unformated.authorNote)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(positionParser(card.innerFormat, card.type), {
                chara: currentChar,
              }).replace('{{slot}}', pmt[i].content || card.defaultText || '')

              if (DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat) {
                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
              }
            }
          }

          pushPrompts(pmt)
          break
        }
        case 'lorebook': {
          pushPrompts(unformated.lorebook)
          break
        }
        case 'postEverything': {
          pushPrompts(unformated.postEverything)
          if (usingPromptTemplate && DBState.db.promptSettings.postEndInnerFormat) {
            pushPrompts([
              {
                role: 'system',
                content: DBState.db.promptSettings.postEndInnerFormat,
              },
            ])
          }
          break
        }
        case 'plain':
        case 'jailbreak':
        case 'cot': {
          if (!DBState.db.jailbreakToggle && card.type === 'jailbreak') {
            continue
          }
          if (!DBState.db.chainOfThought && card.type === 'cot') {
            continue
          }

          const convertRole = {
            system: 'system',
            user: 'user',
            bot: 'assistant',
          } as const

          const posType = card.type === 'plain' ? card.type2 : card.type
          let content = positionParser(card.text, posType)

          if (card.type2 === 'globalNote') {
            if (currentChar.replaceGlobalNote) {
              content = positionParser(currentChar.replaceGlobalNote, posType).replaceAll(
                '{{original}}',
                content,
              )
            }
            if (
              currentChar.prebuiltAssetCommand &&
              !card.text.includes('{{//@customimageinstruction}}')
            ) {
              content += prebuiltAssetCommand
            }
            content = risuChatParser(content, { chara: currentChar, role: card.role })
          } else if (card.type2 === 'main') {
            content = risuChatParser(content, { chara: currentChar, role: card.role })
          } else {
            content = risuChatParser(content, { chara: currentChar, role: card.role })
          }

          const prompt: OpenAIChat = {
            role: convertRole[card.role],
            content: content,
          }

          if (
            DBState.db.promptInfoInsideChat &&
            DBState.db.promptTextInfoInsideChat &&
            card.type2 !== 'globalNote'
          ) {
            pushPromptInfoBody(prompt.role, prompt.content, promptBodyformatedForChatStore)
          }

          pushPrompts([prompt])
          break
        }
        case 'chatML': {
          let prompts = parseChatML(card.text)
          pushPrompts(prompts)
          break
        }
        case 'chat': {
          let start = card.rangeStart
          let end = card.rangeEnd === 'end' ? unformated.chats.length : card.rangeEnd
          if (start === -1000) {
            start = 0
            end = unformated.chats.length
          }
          if (start < 0) {
            start = unformated.chats.length + start
            if (start < 0) {
              start = 0
            }
          }
          if (end < 0) {
            end = unformated.chats.length + end
            if (end < 0) {
              end = 0
            }
          }

          if (start >= end) {
            break
          }

          let chats = unformated.chats.slice(start, end)
          if (
            usingPromptTemplate &&
            DBState.db.promptSettings.sendChatAsSystem &&
            !card.chatAsOriginalOnSystem
          ) {
            chats = systemizeChat(chats)
          }
          pushPrompts(chats)

          if (DBState.db.automaticCachePoint && !hasCachePoint) {
            let pointer = formated.length - 1
            let depthRemaining = 3
            while (pointer >= 0) {
              if (depthRemaining === 0) {
                break
              }
              if (formated[pointer].role === 'user') {
                formated[pointer].cachePoint = true
                depthRemaining--
              }
              pointer--
            }
          }
          break
        }
        case 'memory': {
          let pmt = safeStructuredClone(memories)
          if (card.innerFormat && pmt.length > 0) {
            for (let i = 0; i < pmt.length; i++) {
              pmt[i].content = risuChatParser(card.innerFormat, { chara: currentChar }).replace(
                '{{slot}}',
                pmt[i].content,
              )

              if (DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat) {
                pushPromptInfoBody(pmt[i].role, card.innerFormat, promptBodyformatedForChatStore)
              }
            }
          }

          pushPrompts(pmt)
          break
        }
        case 'cache': {
          let pointer = formated.length - 1
          let depthRemaining = card.depth
          while (pointer >= 0) {
            if (depthRemaining === 0) {
              break
            }
            if (formated[pointer].role === card.role || card.role === 'all') {
              formated[pointer].cachePoint = true
              depthRemaining--
            }
            pointer--
          }
          break
        }
      }
    }
  } else {
    for (let i = 0; i < formatOrder.length; i++) {
      const cha = unformated[formatOrder[i]]
      pushPrompts(cha)
    }
  }

  formated = formated.map((v) => {
    v.content = v.content.trim()
    return v
  })

  if (DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat) {
    promptBodyformatedForChatStore = promptBodyformatedForChatStore.map((v) => {
      v.content = v.content.trim()
      return v
    })
  }

  if (
    currentChar.depth_prompt &&
    currentChar.depth_prompt.prompt &&
    currentChar.depth_prompt.prompt.length > 0
  ) {
    //depth_prompt
    const depthPrompt = currentChar.depth_prompt
    formated.splice(formated.length - depthPrompt.depth, 0, {
      role: 'system',
      content: risuChatParser(depthPrompt.prompt, { chara: currentChar }),
    })
  }

  formated = await runLuaEditTrigger(currentChar, 'editRequest', formated)

  if (DBState.db.promptInfoInsideChat && DBState.db.promptTextInfoInsideChat) {
    promptBodyformatedForChatStore = await runLuaEditTrigger(
      currentChar,
      'editRequest',
      promptBodyformatedForChatStore,
    )
    promptInfo.promptText = promptBodyformatedForChatStore
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

function systemizeChat(chat: OpenAIChat[]) {
  for (let i = 0; i < chat.length; i++) {
    if (chat[i].role === 'user' || chat[i].role === 'assistant') {
      const attr = chat[i].attr ?? []
      if (chat[i].name?.startsWith('example_')) {
        chat[i].content = chat[i].name + ': ' + chat[i].content
      } else if (!attr.includes('nameAdded')) {
        chat[i].content = chat[i].role + ': ' + chat[i].content
      }
      chat[i].role = 'system'
      delete chat[i].memo
      delete chat[i].name
    }
  }
  return chat
}
