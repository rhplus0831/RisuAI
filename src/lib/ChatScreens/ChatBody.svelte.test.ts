import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const chatBodyMocks = vi.hoisted(() => ({
  addMetadataToElement: vi.fn((html: string) => html),
  alertError: vi.fn(),
  getDatabase: vi.fn(),
  getCurrentCharacter: vi.fn(() => ({
    additionalAssets: [],
    prebuiltAssetStyle: 'none',
  })),
  getCurrentChat: vi.fn(() => ({ id: 'chat-a', autoTranslate: true })),
  getSelectedCharacterOwner: vi.fn(() => ({
    additionalAssets: [],
    prebuiltAssetStyle: 'none',
    chaId: 'char-a',
    chatPage: 0,
    chats: [chatBodyMocks.getCurrentChat()],
  })),
  getDistance: vi.fn(() => 0),
  getFileSrc: vi.fn(async (src: string) => src),
  getLLMCache: vi.fn(async () => null),
  getLLMCacheMutationEpoch: vi.fn(() => 0),
  getModuleAssets: vi.fn(() => []),
  chatMetadataOwner: { chatId: 'chat-a', autoTranslate: true } as
    | { chatId: string; autoTranslate: boolean }
    | undefined,
  settingsOwner: {} as Record<string, unknown>,
  ParseMarkdown: vi.fn(async (text: string) => text),
  postTranslationParse: vi.fn(async (html: string) => html),
  sleep: vi.fn(async () => {}),
  translateHTML: vi.fn(async (html: string) => html),
  trimMarkdown: vi.fn((html: string) => html),
}))

vi.mock('../../ts/parser/parser.svelte', () => ({
  addMetadataToElement: chatBodyMocks.addMetadataToElement,
  getDistance: chatBodyMocks.getDistance,
  ParseMarkdown: chatBodyMocks.ParseMarkdown,
  postTranslationParse: chatBodyMocks.postTranslationParse,
  trimMarkdown: chatBodyMocks.trimMarkdown,
}))

vi.mock('../../ts/translator/translator', () => ({
  getLLMCache: chatBodyMocks.getLLMCache,
  getLLMCacheMutationEpoch: chatBodyMocks.getLLMCacheMutationEpoch,
  translateHTML: chatBodyMocks.translateHTML,
}))

vi.mock('../../ts/alert', () => ({
  alertError: chatBodyMocks.alertError,
}))

vi.mock('src/ts/util', () => ({
  sleep: chatBodyMocks.sleep,
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: chatBodyMocks.getModuleAssets,
  getModules: () => [],
  getModuleLorebooks: () => [],
  getModuleRegexScripts: () => [],
  getModuleTriggers: () => [],
  moduleUpdate: () => {},
}))

vi.mock('src/ts/process/scripts', () => ({
  resetScriptCache: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getCurrentCharacter: chatBodyMocks.getCurrentCharacter,
  getCurrentChat: chatBodyMocks.getCurrentChat,
  getDatabase: chatBodyMocks.getDatabase,
}))

vi.mock('src/ts/characterState', () => ({
  getSelectedCharacterOwner: chatBodyMocks.getSelectedCharacterOwner,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  collectionsResourceState: { values: { promptPresets: [] } },
  getCharacterResourceOwner: () => chatBodyMocks.getSelectedCharacterOwner(),
  getChatMetadataOwnerState: (chatId: string) =>
    chatBodyMocks.chatMetadataOwner?.chatId === chatId ? chatBodyMocks.chatMetadataOwner : undefined,
  settingsResourceState: {
    get value() {
      return chatBodyMocks.settingsOwner
    },
  },
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  getFileSrc: chatBodyMocks.getFileSrc,
}))

import ChatBody from './ChatBody.svelte'

chatBodyMocks.getDatabase.mockImplementation(() => chatBodyMocks.settingsOwner)

async function flushComponentPromises() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
    await tick()
  }
}

function setChatBodyDatabase(overrides: Record<string, unknown> = {}) {
  chatBodyMocks.settingsOwner = {
    autoTranslateCachedOnly: false,
    legacyTranslation: false,
    newImageHandlingBeta: false,
    showTranslationLoading: false,
    translateBeforeHTMLFormatting: false,
    translatorType: 'google',
    ...overrides,
  }
}

describe('ChatBody translation parse bounds', () => {
  let target: HTMLElement
  let component: Record<string, never> | undefined

  beforeEach(() => {
    target = document.createElement('div')
    document.body.appendChild(target)
    vi.clearAllMocks()
    chatBodyMocks.chatMetadataOwner = { chatId: 'chat-a', autoTranslate: true }
    chatBodyMocks.getCurrentChat.mockReturnValue({ id: 'chat-a', autoTranslate: true })
    chatBodyMocks.getSelectedCharacterOwner.mockImplementation(() => ({
      additionalAssets: [],
      prebuiltAssetStyle: 'none',
      chaId: 'char-a',
      chatPage: 0,
      chats: [chatBodyMocks.getCurrentChat()],
    }))
    setChatBodyDatabase()
  })

  afterEach(() => {
    if (component) {
      unmount(component)
      component = undefined
    }
    target.remove()
    document.body.innerHTML = ''
    chatBodyMocks.settingsOwner = {}
  })

  it('surfaces translateHTML failure once without retrying the full pipeline', async () => {
    chatBodyMocks.ParseMarkdown.mockResolvedValue('marked:source message')
    chatBodyMocks.translateHTML.mockRejectedValue(new Error('translator unavailable'))

    component = mount(ChatBody, {
      target,
      props: {
        idx: 0,
        modelShortName: '',
        msgDisplay: 'source message',
        role: 'char',
        translated: true,
        translating: false,
        retranslate: false,
      },
    })
    flushSync()
    await flushComponentPromises()

    expect(chatBodyMocks.translateHTML).toHaveBeenCalledTimes(1)
    expect(chatBodyMocks.ParseMarkdown).toHaveBeenCalledTimes(1)
    expect(chatBodyMocks.alertError).toHaveBeenCalledTimes(1)
    expect(chatBodyMocks.alertError.mock.calls[0][0]).toContain('translator unavailable')
    expect(target.textContent).toContain('source message')
  })

  it('retries parser failures against already translated HTML only', async () => {
    setChatBodyDatabase({
      translateBeforeHTMLFormatting: true,
      translatorType: 'llm',
    })
    const parseInputs: string[] = []
    chatBodyMocks.translateHTML.mockResolvedValue('translated html')
    chatBodyMocks.ParseMarkdown.mockImplementation(async (text: string) => {
      parseInputs.push(text)
      if (parseInputs.length < 4) {
        throw new Error(`parse failed ${parseInputs.length}`)
      }
      return `parsed:${text}`
    })

    component = mount(ChatBody, {
      target,
      props: {
        idx: 0,
        modelShortName: '',
        msgDisplay: 'source message',
        role: 'char',
        translated: true,
        translating: false,
        retranslate: false,
      },
    })
    flushSync()
    await flushComponentPromises()

    expect(chatBodyMocks.translateHTML).toHaveBeenCalledTimes(1)
    expect(chatBodyMocks.ParseMarkdown).toHaveBeenCalledTimes(4)
    expect(parseInputs).toEqual(['translated html', 'translated html', 'translated html', 'translated html'])
    expect(chatBodyMocks.alertError).not.toHaveBeenCalled()
    expect(target.textContent).toContain('parsed:translated html')
  })

  it('skips client-path auto-translation for user rows in active-chat bot-only mode', async () => {
    chatBodyMocks.getCurrentChat.mockReturnValue({
      id: 'chat-a',
      autoTranslate: true,
      autoTranslateBotOnly: true,
    } as never)
    component = mount(ChatBody, {
      target,
      props: {
        idx: -1,
        modelShortName: '',
        msgDisplay: 'preview user message',
        role: 'user',
        translated: false,
        translating: false,
        retranslate: false,
      },
    })
    flushSync()
    await flushComponentPromises()

    expect(chatBodyMocks.translateHTML).not.toHaveBeenCalled()
    expect(target.textContent).toContain('preview user message')
  })

  it('fails closed for automatic translation when the active chat owner is missing or ambiguous', async () => {
    chatBodyMocks.chatMetadataOwner = undefined
    component = mount(ChatBody, {
      target,
      props: {
        idx: -1,
        modelShortName: '',
        msgDisplay: 'ownerless preview message',
        role: 'char',
        translated: false,
        translating: false,
        retranslate: false,
      },
    })
    flushSync()
    await flushComponentPromises()

    expect(chatBodyMocks.translateHTML).not.toHaveBeenCalled()
    expect(target.textContent).toContain('ownerless preview message')
  })

  it('resolves rendered image assets from the selected character and chat owners', async () => {
    setChatBodyDatabase({ newImageHandlingBeta: true })
    const owner = {
      additionalAssets: [['portrait.png', 'owner-asset-id', 'png']],
      prebuiltAssetStyle: 'contain',
      chaId: 'char-a',
      chatPage: 0,
      chats: [chatBodyMocks.getCurrentChat()],
    }
    chatBodyMocks.getSelectedCharacterOwner.mockReturnValue(owner as never)
    chatBodyMocks.getFileSrc.mockResolvedValue('/api/v1/assets/owner-asset-id')
    const bodyRoot = document.createElement('span')
    bodyRoot.innerHTML = '<img src="portrait.png">'
    target.appendChild(bodyRoot)

    component = mount(ChatBody, {
      target,
      props: {
        bodyRoot,
        idx: 0,
        modelShortName: '',
        msgDisplay: 'image owner body',
        role: 'char',
        translated: false,
        translating: false,
        retranslate: false,
        allowClientTranslation: false,
      },
    })
    flushSync()
    await flushComponentPromises()

    expect(chatBodyMocks.getModuleAssets).toHaveBeenCalledWith({
      character: owner,
      chat: owner.chats[0],
    })
    expect(chatBodyMocks.getFileSrc).toHaveBeenCalledWith('owner-asset-id')
    expect(bodyRoot.querySelector('img')?.getAttribute('src')).toBe('/api/v1/assets/owner-asset-id')
    expect(bodyRoot.querySelector('img')?.classList.contains('root-loaded-image-contain')).toBe(true)
  })

  it('reports the first display parse as pending until its rendered body settles', async () => {
    let resolveParse!: (value: string) => void
    const pendingParse = new Promise<string>((resolve) => {
      resolveParse = resolve
    })
    const onInitialDisplayParseStart = vi.fn()
    const onInitialDisplayParseSettled = vi.fn()
    chatBodyMocks.ParseMarkdown.mockReturnValue(pendingParse)

    component = mount(ChatBody, {
      target,
      props: {
        idx: 0,
        modelShortName: '',
        msgDisplay: 'source message',
        role: 'char',
        translated: false,
        translating: false,
        retranslate: false,
        allowClientTranslation: false,
        onInitialDisplayParseStart,
        onInitialDisplayParseSettled,
      },
    })
    flushSync()

    expect(onInitialDisplayParseStart).toHaveBeenCalledOnce()
    expect(onInitialDisplayParseSettled).not.toHaveBeenCalled()

    resolveParse('parsed source message')
    await flushComponentPromises()

    expect(target.textContent).toContain('parsed source message')
    expect(onInitialDisplayParseSettled).toHaveBeenCalledOnce()
    expect(onInitialDisplayParseSettled).toHaveBeenCalledWith(onInitialDisplayParseStart.mock.calls[0][0])
  })

  it('settles an outstanding initial display registration when the body unmounts', () => {
    const onInitialDisplayParseStart = vi.fn()
    const onInitialDisplayParseSettled = vi.fn()
    chatBodyMocks.ParseMarkdown.mockReturnValue(new Promise<string>(() => undefined))

    component = mount(ChatBody, {
      target,
      props: {
        idx: 0,
        modelShortName: '',
        msgDisplay: 'source message',
        role: 'char',
        translated: false,
        translating: false,
        retranslate: false,
        allowClientTranslation: false,
        onInitialDisplayParseStart,
        onInitialDisplayParseSettled,
      },
    })
    flushSync()

    unmount(component)
    component = undefined

    expect(onInitialDisplayParseStart).toHaveBeenCalledOnce()
    expect(onInitialDisplayParseSettled).toHaveBeenCalledOnce()
    expect(onInitialDisplayParseSettled).toHaveBeenCalledWith(onInitialDisplayParseStart.mock.calls[0][0])
  })
})
