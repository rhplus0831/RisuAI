import { mount, tick, unmount } from 'svelte'
import { get } from 'svelte/store'
import { vi } from 'vitest'
import type { character, customscript, Message } from '../storage/database.svelte'
import {
  DBState,
  HideIconStore,
  ReloadChatPointer,
  ReloadGUIPointer,
  VariableReloadGUIPointer,
  refreshVariableOnlyGui,
  reloadGuiAfterDefinitionChange,
  reloadGuiDisplay,
  selectedCharID,
} from '../stores.svelte'

export interface RenderParseCounts {
  parseMarkdown: number
  risuChatParser: number
  editDisplay: number
}

export interface RenderCacheProof {
  regexCacheWarmBeforeBump: boolean
  regexCacheWipedAfterBump: boolean
  scriptCacheWarmBeforeBump: boolean
  scriptCacheWipedAfterBump: boolean
}

export interface RenderCostHarnessResult {
  mountedMessages: number
  visibleMessageTexts: string[]
  parsesBeforeBump: RenderParseCounts
  parsesAfterBump: RenderParseCounts
  editDisplayRunsAfterBump: number
  cacheWarmBeforeBump: boolean
  cacheWiped: boolean
  cacheProof: RenderCacheProof
}

export interface RenderCostHarnessOptions {
  messageCount: number
  reloadKind?: 'variable-only' | 'definition' | 'display'
}

interface RenderCostSeed {
  character: character
  messages: Message[]
}

interface CacheProofBefore {
  regexBefore: RegExp
  regexCacheWarmBeforeBump: boolean
  scriptCacheWarmBeforeBump: boolean
}

const REGEX_CACHE_PROOF_SOURCE = 'render-cost-regex-cache-proof-(\\d+)'
const SCRIPT_CACHE_PROOF_INPUT = 'prefix render-cost-script-cache-proof-token suffix'
const SCRIPT_CACHE_WARM_SENTINEL = 'script-cache-warm-before-bump'
const SCRIPT_CACHE_AFTER_SENTINEL = 'script-cache-after-bump'

const SCRIPT_CACHE_PROOF_SCRIPT: customscript = {
  id: 'render-cost-script-cache-proof',
  comment: 'render cost harness script cache proof',
  in: 'render-cost-script-cache-proof-token',
  out: '@@inject',
  type: 'editdisplay',
  flag: 'g',
  ableFlag: true,
}

function stableMessageText(index: number): string {
  return `Phase 0 render-cost message ${index}: stable visible text ${String(index).padStart(2, '0')}`
}

export function seedRenderCostMessages(messageCount: number): RenderCostSeed {
  const messages: Message[] = Array.from({ length: messageCount }, (_unused, index) => ({
    role: index % 2 === 0 ? 'char' : 'user',
    data: stableMessageText(index),
    chatId: `render-cost-message-${index}`,
  }))

  const character = {
    chaId: 'render-cost-character',
    name: 'Render Harness',
    image: '',
    desc: '',
    chatPage: 0,
    chats: [
      {
        id: 'render-cost-chat',
        name: 'Render Harness Chat',
        message: messages,
        note: '',
        localLore: [],
        scriptstate: {},
        fmIndex: -1,
        bookmarks: [],
        bookmarkNames: {},
      },
    ],
    customscript: [],
    triggerscript: [],
    defaultVariables: '',
    globalLore: [],
    additionalAssets: [],
    emotionImages: [],
    virtualscript: '',
    type: 'character',
    ttsMode: 'none',
    hideChatIcon: false,
  } as unknown as character

  selectedCharID.set(0)
  ReloadChatPointer.set({})
  ReloadGUIPointer.set(0)
  VariableReloadGUIPointer.set(0)
  HideIconStore.set(false)
  DBState.db = {
    characters: [character],
    characterOrder: [character.chaId],
    currentChar: 0,
    presetRegex: [],
    globalscript: [],
    modules: [],
    enabledModules: [],
    moduleIntergration: '',
    templateDefaultVariables: '',
    globalChatVariables: {},
    username: 'Harness User',
    userIcon: '',
    theme: '',
    roundIcons: false,
    iconsize: 100,
    zoomsize: 100,
    lineHeight: 1.25,
    memoryLimitThickness: 0,
    translator: '',
    translatorType: 'none',
    autoTranslate: false,
    autoTranslateCachedOnly: false,
    translateBeforeHTMLFormatting: false,
    legacyTranslation: false,
    showTranslationLoading: false,
    newImageHandlingBeta: false,
    clickToEdit: false,
    useChatCopy: false,
    enableBookmark: false,
    swipe: false,
    showFirstMessagePages: false,
    enableBlockPartialEdit: false,
    enableDragPartialEdit: false,
    askRemoval: false,
    instantRemove: false,
    customQuotes: false,
    blockquoteStyling: false,
    unformatQuotes: false,
    hideAllImages: false,
    dynamicAssets: false,
    dynamicAssetsEditDisplay: false,
  } as any

  return { character, messages }
}

function subtractCounts(after: RenderParseCounts, before: RenderParseCounts): RenderParseCounts {
  return {
    parseMarkdown: after.parseMarkdown - before.parseMarkdown,
    risuChatParser: after.risuChatParser - before.risuChatParser,
    editDisplay: after.editDisplay - before.editDisplay,
  }
}

async function settleRenderWork(): Promise<void> {
  for (let i = 0; i < 4; i += 1) {
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

async function waitForVisibleMessages(target: HTMLElement, expectedTexts: string[]): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await settleRenderWork()
    const mountedMessages = target.querySelectorAll('.risu-chat').length
    const text = target.textContent ?? ''
    if (
      mountedMessages === expectedTexts.length &&
      expectedTexts.every((item) => text.includes(item))
    ) {
      return
    }
  }

  throw new Error(
    `render-cost harness did not mount all visible messages; saw ${target.querySelectorAll('.risu-chat').length}`,
  )
}

function buildCacheProofCharacter(base: character): character {
  return {
    ...base,
    customscript: [SCRIPT_CACHE_PROOF_SCRIPT],
  } as character
}

async function warmCachesBeforeBump(
  scriptsModule: typeof import('../process/scripts'),
  proofCharacter: character,
): Promise<CacheProofBefore> {
  const regexBefore = scriptsModule.getCompiledRegex(REGEX_CACHE_PROOF_SOURCE, 'g')
  const regexBeforeAgain = scriptsModule.getCompiledRegex(REGEX_CACHE_PROOF_SOURCE, 'g')
  const proofMessage = DBState.db.characters[0].chats[0].message[0]

  await scriptsModule.processScriptFull(proofCharacter, SCRIPT_CACHE_PROOF_INPUT, 'editdisplay', 0)
  proofMessage.data = SCRIPT_CACHE_WARM_SENTINEL
  await scriptsModule.processScriptFull(proofCharacter, SCRIPT_CACHE_PROOF_INPUT, 'editdisplay', 0)

  return {
    regexBefore,
    regexCacheWarmBeforeBump: regexBefore === regexBeforeAgain,
    scriptCacheWarmBeforeBump: proofMessage.data === SCRIPT_CACHE_WARM_SENTINEL,
  }
}

async function finishCacheProofAfterBump(
  scriptsModule: typeof import('../process/scripts'),
  proofCharacter: character,
  before: CacheProofBefore,
): Promise<RenderCacheProof> {
  const proofMessage = DBState.db.characters[0].chats[0].message[0]
  const regexAfter = scriptsModule.getCompiledRegex(REGEX_CACHE_PROOF_SOURCE, 'g')

  proofMessage.data = SCRIPT_CACHE_AFTER_SENTINEL
  await scriptsModule.processScriptFull(proofCharacter, SCRIPT_CACHE_PROOF_INPUT, 'editdisplay', 0)

  return {
    regexCacheWarmBeforeBump: before.regexCacheWarmBeforeBump,
    regexCacheWipedAfterBump: regexAfter !== before.regexBefore,
    scriptCacheWarmBeforeBump: before.scriptCacheWarmBeforeBump,
    scriptCacheWipedAfterBump: proofMessage.data === SCRIPT_CACHE_PROOF_INPUT,
  }
}

export async function runRenderCostHarness(
  options: RenderCostHarnessOptions,
): Promise<RenderCostHarnessResult> {
  const previousDb = DBState.db
  const previousSelectedChar = get(selectedCharID)
  const previousReloadGui = get(ReloadGUIPointer)
  const previousVariableReloadGui = get(VariableReloadGUIPointer)
  const previousReloadChat = get(ReloadChatPointer)
  const previousHideIcon = get(HideIconStore)
  const target = document.createElement('div')
  const mounted: Array<Record<string, never>> = []

  document.body.appendChild(target)

  const scriptsModule = await import('../process/scripts')
  const processScriptFullSpy = vi.spyOn(scriptsModule, 'processScriptFull')
  const risuChatParserSpy = vi.spyOn(scriptsModule, 'risuChatParser')
  const parserModule = await import('../parser/parser.svelte')
  const parseMarkdownSpy = vi.spyOn(parserModule, 'ParseMarkdown')
  const parseMemoModule = await import('../../lib/ChatScreens/ChatBodyParseMemo')
  parseMemoModule.clearChatBodyParseMemo()

  const snapshotCounts = (): RenderParseCounts => ({
    parseMarkdown: parseMarkdownSpy.mock.calls.length,
    risuChatParser: risuChatParserSpy.mock.calls.length,
    editDisplay: processScriptFullSpy.mock.calls.filter((call) => call[2] === 'editdisplay').length,
  })

  try {
    const seed = seedRenderCostMessages(options.messageCount)
    const proofCharacter = buildCacheProofCharacter(seed.character)
    const visibleMessageTexts = seed.messages.map((message) => message.data)
    const { default: Chat } = await import('../../lib/ChatScreens/Chat.svelte')

    for (const [index, message] of seed.messages.entries()) {
      const host = document.createElement('div')
      target.appendChild(host)
      mounted.push(
        mount(Chat, {
          target: host,
          props: {
            message: message.data,
            name: message.role === 'user' ? 'Harness User' : seed.character.name,
            isLastMemory: false,
            img: '',
            idx: index,
            role: message.role,
            totalLength: seed.messages.length,
            character: seed.character.chaId,
            firstMessage: index === 0,
            disabled: false,
            rerollIcon: false,
            largePortrait: false,
          },
        }) as Record<string, never>,
      )
    }

    await waitForVisibleMessages(target, visibleMessageTexts)
    const mountedMessages = target.querySelectorAll('.risu-chat').length
    const parsesBeforeBump = snapshotCounts()
    const cacheBefore = await warmCachesBeforeBump(scriptsModule, proofCharacter)
    const countsAtBump = snapshotCounts()

    switch (options.reloadKind ?? 'variable-only') {
      case 'definition':
        reloadGuiAfterDefinitionChange()
        break
      case 'display':
        reloadGuiDisplay()
        break
      case 'variable-only':
        refreshVariableOnlyGui()
        break
    }
    await waitForVisibleMessages(target, visibleMessageTexts)

    const parsesAfterBump = subtractCounts(snapshotCounts(), countsAtBump)
    const cacheProof = await finishCacheProofAfterBump(scriptsModule, proofCharacter, cacheBefore)

    return {
      mountedMessages,
      visibleMessageTexts,
      parsesBeforeBump,
      parsesAfterBump,
      editDisplayRunsAfterBump: parsesAfterBump.editDisplay,
      cacheWarmBeforeBump:
        cacheProof.regexCacheWarmBeforeBump && cacheProof.scriptCacheWarmBeforeBump,
      cacheWiped: cacheProof.regexCacheWipedAfterBump && cacheProof.scriptCacheWipedAfterBump,
      cacheProof,
    }
  } finally {
    for (const component of mounted.reverse()) {
      unmount(component)
    }
    target.remove()
    processScriptFullSpy.mockRestore()
    risuChatParserSpy.mockRestore()
    parseMarkdownSpy.mockRestore()
    parseMemoModule.clearChatBodyParseMemo()
    DBState.db = previousDb
    selectedCharID.set(previousSelectedChar)
    ReloadChatPointer.set(previousReloadChat)
    ReloadGUIPointer.set(previousReloadGui)
    VariableReloadGUIPointer.set(previousVariableReloadGui)
    HideIconStore.set(previousHideIcon)
  }
}
