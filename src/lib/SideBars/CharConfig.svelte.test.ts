import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type MockSelectedFile = { name: string; data: Uint8Array }
type MockSingleFileRead = {
  selected: MockSelectedFile | null
  result: Promise<MockSelectedFile | null> | MockSelectedFile | null
}
type MockMultipleFileRead = {
  selected: MockSelectedFile[]
  result: Promise<MockSelectedFile[] | null> | MockSelectedFile[] | null
}

const chatCommandMocks = vi.hoisted(() => ({
  setCurrentChatGreetingIndex: vi.fn(),
}))

const selectedFileState = vi.hoisted(() => ({
  singleQueue: [] as Array<Promise<MockSelectedFile | null> | MockSingleFileRead | MockSelectedFile | null>,
  multipleQueue: [] as Array<Promise<MockSelectedFile[] | null> | MockMultipleFileRead | MockSelectedFile[] | null>,
}))

const transformerMocks = vi.hoisted(() => ({
  registerOnnxModelFromFileCalls: [] as Array<{
    file: MockSelectedFile
    options: { shouldContinue?: () => boolean } | undefined
  }>,
  registerOnnxModelFromFileQueue: [] as Array<Promise<unknown> | unknown>,
}))

const assetMocks = vi.hoisted(() => ({
  saveAsset: vi.fn(),
}))

const characterMediaMocks = vi.hoisted(() => ({
  selectCharacterAvatarImage: vi.fn(),
}))

const ttsCatalogMocks = vi.hoisted(() => ({
  getElevenTTSVoices: vi.fn(),
  getFishSpeechModels: vi.fn(),
}))

const serverCommandState = vi.hoisted(() => ({
  enabled: false,
  updateCharacterCalls: [] as Record<string, unknown>[],
}))

const regexImportMocks = vi.hoisted(() => ({
  importRegexRows: vi.fn(),
}))

vi.mock('src/ts/server/commands', () => {
  const command =
    (kind: string) =>
    async (args: Record<string, unknown> = {}) => ({
      kind,
      ...args,
    })

  return {
    appendMessageCommand: command('appendMessage'),
    canUseServerCommands: () => serverCommandState.enabled,
    createAndSelectCharacterCommand: command('createAndSelectCharacter'),
    createCharacterCommand: command('createCharacter'),
    createChatCommand: command('createChat'),
    createChatFolderCommand: command('createChatFolder'),
    deleteCharacterCommand: command('deleteCharacter'),
    deleteChatCommand: command('deleteChat'),
    deleteChatFolderCommand: command('deleteChatFolder'),
    deleteMessageCommand: command('deleteMessage'),
    forkChatCommand: command('forkChat'),
    patchChatScriptstateCommand: command('patchChatScriptstate'),
    reorderCharacterFoldersCommand: command('reorderCharacterFolders'),
    reorderCharactersCommand: command('reorderCharacters'),
    reorderChatFoldersCommand: command('reorderChatFolders'),
    reorderChatsCommand: command('reorderChats'),
    replaceCharacterScriptsCommand: command('replaceCharacterScripts'),
    replaceCharacterTriggersCommand: command('replaceCharacterTriggers'),
    replaceMessagesCommand: command('replaceMessages'),
    replaceModuleScriptsCommand: command('replaceModuleScripts'),
    replaceModuleTriggersCommand: command('replaceModuleTriggers'),
    replaceTailMessagesCommand: command('replaceTailMessages'),
    runServerCommand: vi.fn(async ({ command: buildCommand }: { command?: (baseRevision: number) => unknown }) => {
      if (buildCommand) await buildCommand(1)
      return { status: 'ok', revision: 1 }
    }),
    saveChatGenerationSettingsCommand: command('saveChatGenerationSettings'),
    selectCharacterCommand: command('selectCharacter'),
    subscribeServerCommandLocalEffectApplied: vi.fn(() => () => {}),
    truncateMessagesCommand: command('truncateMessages'),
    updateCharacterCommand: vi.fn(async (args: Record<string, unknown> = {}) => {
      serverCommandState.updateCharacterCalls.push(structuredClone(args))
      return { kind: 'updateCharacter', ...args }
    }),
    updateChatCommand: command('updateChat'),
    updateChatFolderCommand: command('updateChatFolder'),
    updateMessageCommand: command('updateMessage'),
  }
})

vi.mock('src/ts/chatCommands', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/chatCommands')>()

  return {
    ...actual,
    setCurrentChatGreetingIndex: (
      ...args: Parameters<typeof actual.setCurrentChatGreetingIndex>
    ): ReturnType<typeof actual.setCurrentChatGreetingIndex> => {
      chatCommandMocks.setCurrentChatGreetingIndex(...args)
      return actual.setCurrentChatGreetingIndex(...args)
    },
  }
})

vi.mock('src/ts/tokenizer', () => ({
  tokenizeAccurate: vi.fn(async () => 0),
}))

vi.mock('../../ts/characters', async () => {
  const { writable } = await import('svelte/store')

  return {
    addCharEmotion: vi.fn(),
    addingEmotion: writable(false),
    changeCharImage: vi.fn(),
    createBlankChar: vi.fn(() => ({ name: 'Blank' })),
    getCharImage: vi.fn(async (location: string, type: string) =>
      type === 'plain' ? location : `background: url("${location}");`,
    ),
    removeChar: vi.fn(),
    rmCharEmotion: vi.fn(),
    selectCharacterAvatarImage: characterMediaMocks.selectCharacterAvatarImage,
    selectCharImg: vi.fn(),
  }
})

vi.mock('../../ts/util', async (importActual) => {
  const actual = await importActual<typeof import('../../ts/util')>()

  return {
    ...actual,
    selectMultipleFile: vi.fn(
      async (_extensions: string[], options: { onFilesSelected?: (files: File[]) => void } = {}) => {
        const queued = selectedFileState.multipleQueue.shift()
        if (queued && typeof queued === 'object' && 'selected' in queued && 'result' in queued) {
          if (queued.selected.length > 0) {
            options.onFilesSelected?.(queued.selected as unknown as File[])
          }
          return queued.result ? await queued.result : queued.result
        }

        const selected = queued ? await queued : queued
        if (Array.isArray(selected) && selected.length > 0) {
          options.onFilesSelected?.(selected as unknown as File[])
        }
        return selected
      },
    ),
    selectSingleFile: vi.fn(async (_extensions: string[], options: { onFileSelected?: (file: File) => void } = {}) => {
      const queued = selectedFileState.singleQueue.shift()
      if (queued && typeof queued === 'object' && 'selected' in queued && 'result' in queued) {
        if (queued.selected) {
          options.onFileSelected?.(queued.selected as unknown as File)
        }
        return queued.result ? await queued.result : queued.result
      }

      const selected = queued ? await queued : queued
      if (selected) {
        options.onFileSelected?.(selected as unknown as File)
      }
      return selected
    }),
  }
})

vi.mock('src/ts/characterCards', () => ({
  exportChar: vi.fn(),
  hubURL: 'https://example.test',
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  aiWatermarkingLawApplies: false,
  downloadFile: vi.fn(),
  getFileSrc: vi.fn(async () => ''),
  globalFetch: vi.fn(async () => new Response('{}')),
  saveAsset: assetMocks.saveAsset,
}))

vi.mock('src/ts/process/inlayScreen', () => ({
  updateInlayScreen: vi.fn((character: unknown) => character),
}))

vi.mock('src/ts/process/modules', () => ({
  applyModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/process/scripts', () => ({
  exportRegex: vi.fn(),
  importRegexRows: regexImportMocks.importRegexRows,
  resetScriptCache: vi.fn(),
}))

vi.mock('src/ts/process/transformers', () => ({
  registerOnnxModelFromFile: vi.fn(async (file, options) => {
    transformerMocks.registerOnnxModelFromFileCalls.push({ file, options })
    const next = transformerMocks.registerOnnxModelFromFileQueue.shift()
    return next ? await next : null
  }),
}))

vi.mock('src/ts/process/tts', () => ({
  getElevenTTSVoices: ttsCatalogMocks.getElevenTTSVoices,
  getFishSpeechModels: ttsCatalogMocks.getFishSpeechModels,
  getNovelAIVoices: vi.fn(() => []),
  getVOICEVOXVoices: vi.fn(() => []),
  getWebSpeechTTSVoices: vi.fn((synthesis?: Pick<SpeechSynthesis, 'getVoices'>) =>
    (synthesis?.getVoices() ?? []).map((voice) => voice.name),
  ),
  oaiVoices: [],
}))

vi.mock('../Others/Help.svelte', async () => {
  const mock = await import('./CharConfig.testHelp.svelte')
  return { default: mock.default }
})

vi.mock('../UI/GUI/TextAreaInput.svelte', async () => {
  const mock = await import('./CharConfig.testTextAreaInput.svelte')
  return { default: mock.default }
})

vi.mock('../UI/GUI/MultiLangInput.svelte', async () => {
  const mock = await import('./CharConfig.testMultiLangInput.svelte')
  return { default: mock.default }
})

vi.mock('./Scripts/RegexList.svelte', async () => {
  const mock = await import('./CharConfig.testRegexList.svelte')
  return { default: mock.default }
})

vi.mock('./Scripts/TriggerList.svelte', async () => {
  const mock = await import('./CharConfig.testTriggerList.svelte')
  return { default: mock.default }
})

import CharConfig from './CharConfig.svelte'
import { CharConfigSubMenu, MobileGUI, selectedCharID } from 'src/ts/stores.svelte'
import { getDatabase, setDatabaseLite, type character } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

function charConfigSource(): string {
  return readFileSync(resolve(process.cwd(), 'src/lib/SideBars/CharConfig.svelte'), 'utf8')
}

function sourceBetween(source: string, startNeedle: string, endNeedle: string): string {
  const start = source.indexOf(startNeedle)
  const end = source.indexOf(endNeedle, start + startNeedle.length)

  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)

  return source.slice(start, end)
}

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function makeCharacter(fields: Partial<character> = {}): character {
  return {
    type: 'character',
    chaId: 'char-1',
    name: 'Character A',
    displayName: '',
    image: '',
    firstMessage: 'Hello',
    desc: 'Description',
    notes: '',
    chats: [
      {
        id: 'chat-1',
        name: 'Chat',
        message: [],
        fmIndex: 2,
      },
    ],
    chatFolders: [],
    chatPage: 0,
    viewScreen: 'none',
    bias: [],
    emotionImages: [],
    globalLore: [],
    sdData: [],
    newGenData: {
      prompt: '',
      negative: '',
      instructions: '',
      emotionInstructions: '',
    },
    customscript: [],
    triggerscript: [],
    utilityBot: false,
    exampleMessage: '',
    creatorNotes: '',
    systemPrompt: '',
    postHistoryInstructions: '',
    alternateGreetings: [],
    tags: [],
    creator: '',
    characterVersion: '',
    personality: '',
    scenario: '',
    firstMsgIndex: 0,
    replaceGlobalNote: '',
    additionalText: '',
    additionalData: {
      creator: '',
      character_version: '',
    },
    depth_prompt: {
      depth: 4,
      prompt: '',
    },
    defaultVariables: '',
    translatorNote: '',
    lowLevelAccess: false,
    ...fields,
  } as character
}

async function settleComponent(): Promise<void> {
  await tick()
  await Promise.resolve()
  await tick()
}

async function mountCharConfig(subMenu: number, characterFields: Partial<character> = {}): Promise<void> {
  setDatabaseLite({
    characters: [makeCharacter(characterFields)],
    currentChar: 0,
    fishSpeechKey: '',
    hypaV3: false,
    newImageHandlingBeta: false,
    showDeprecatedTriggerV1: false,
    showUnrecommended: false,
    useAdditionalAssetsPreview: false,
  } as never)
  selectedCharID.set(0)
  CharConfigSubMenu.set(0)
  MobileGUI.set(true)

  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(CharConfig, { target })
  await settleComponent()

  CharConfigSubMenu.set(subMenu)
  await settleComponent()
}

function buttons(): HTMLButtonElement[] {
  return Array.from(target.querySelectorAll('button'))
}

function buttonByText(text: string): HTMLButtonElement {
  const button = buttons().find((candidate) => candidate.textContent?.trim() === text)
  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

function buttonByAccessibleName(name: string): HTMLButtonElement {
  const button = buttons().find((candidate) => candidate.getAttribute('aria-label') === name)
  expect(button, `button named ${name}`).toBeTruthy()
  return button as HTMLButtonElement
}

function selectedFile(name: string, data = new Uint8Array([1, 2, 3])): MockSelectedFile {
  return { name, data }
}

function notificationImageAddButton(): HTMLButtonElement {
  const tile = target.querySelector('div.h-20.w-20.border-dashed')
  const button = tile?.closest('button')
  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

function notificationImageClearButton(): HTMLButtonElement {
  const card = notificationImageAddButton().closest('div.p-2.border-darkborderc')
  const button = card?.querySelector('button.text-textcolor2')
  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

function avatarAddButton(): HTMLButtonElement {
  const tile = target.querySelector('div.h-24.w-24.border-dashed')
  const button = tile?.closest('button')
  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

async function showCharacterViewScreen(): Promise<void> {
  buttons()[1].click()
  await settleComponent()
}

function emotionAddButton(): HTMLButtonElement {
  const button = target.querySelector('svg.lucide-plus')?.closest('button')
  expect(button).toBeTruthy()
  return button as HTMLButtonElement
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.useFakeTimers()
  chatCommandMocks.setCurrentChatGreetingIndex.mockClear()
  selectedFileState.singleQueue.length = 0
  selectedFileState.multipleQueue.length = 0
  transformerMocks.registerOnnxModelFromFileCalls.length = 0
  transformerMocks.registerOnnxModelFromFileQueue.length = 0
  characterMediaMocks.selectCharacterAvatarImage.mockReset().mockResolvedValue(undefined)
  ttsCatalogMocks.getElevenTTSVoices.mockReset().mockResolvedValue([])
  ttsCatalogMocks.getFishSpeechModels.mockReset().mockResolvedValue([])
  serverCommandState.enabled = false
  serverCommandState.updateCharacterCalls.length = 0
  regexImportMocks.importRegexRows.mockReset().mockResolvedValue(null)
  assetMocks.saveAsset.mockReset().mockResolvedValue('asset-id')
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    return window.setTimeout(() => callback(performance.now()), 0)
  })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target?.remove()
  document.body.innerHTML = ''
  selectedCharID.set(-1)
  serverCommandState.enabled = false
  CharConfigSubMenu.set(0)
  MobileGUI.set(false)
  setDatabaseLite({} as never)
  vi.unstubAllGlobals()
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('CharConfig desktop section navigation', () => {
  it('names every section and exposes the selected section', async () => {
    await mountCharConfig(0)
    MobileGUI.set(false)
    await settleComponent()

    const expectedNames = {
      profile: language.character,
      display: language.characterDisplay,
      lorebook: language.loreBook,
      tts: 'TTS',
      scripts: language.scripts,
      advanced: language.advancedSettings,
      manage: `${language.exportCharacter} / ${language.removeCharacter}`,
    }
    const sectionButtons = Array.from(target.querySelectorAll<HTMLButtonElement>('[data-char-config-section]'))
    expect(sectionButtons).toHaveLength(7)
    for (const button of sectionButtons) {
      const section = button.dataset.charConfigSection as keyof typeof expectedNames
      expect(button.getAttribute('aria-label')).toBe(expectedNames[section])
      expect(button.title).toBe(expectedNames[section])
      expect(button.getAttribute('aria-pressed')).toBe(section === 'profile' ? 'true' : 'false')
    }

    target.querySelector<HTMLButtonElement>('[data-char-config-section="scripts"]')?.click()
    await settleComponent()
    expect(target.querySelector('[data-char-config-section="profile"]')?.getAttribute('aria-pressed')).toBe('false')
    expect(target.querySelector('[data-char-config-section="scripts"]')?.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('CharConfig editor action accessibility', () => {
  it('names media actions and exposes display and removal toggle state', async () => {
    await mountCharConfig(1, {
      image: 'primary-avatar',
      ccAssets: [{ type: 'icon', name: 'alternate', uri: 'alternate-avatar', ext: 'png' }],
      notificationImage: 'notification-image',
      additionalAssets: [['portrait', 'asset-1', 'png']],
    })

    const iconTab = buttonByText(language.charIcon)
    const viewTab = buttonByText(language.viewScreen)
    const assetsTab = buttonByText(language.additionalAssets)
    expect(iconTab.getAttribute('aria-pressed')).toBe('true')
    expect(viewTab.getAttribute('aria-pressed')).toBe('false')
    expect(assetsTab.getAttribute('aria-pressed')).toBe('false')

    expect(buttonByAccessibleName(`${language.select}: ${language.charIcon}`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.select}: ${language.charIcon} 2`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.add}: ${language.charIcon}`)).toBe(avatarAddButton())
    expect(buttonByAccessibleName(`${language.remove}: ${language.notificationImage}`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.edit}: ${language.notificationImage}`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.add}: ${language.notificationImage}`)).toBeTruthy()

    const removeMode = buttonByAccessibleName(`${language.remove}: ${language.charIcon}`)
    expect(removeMode.getAttribute('aria-pressed')).toBe('false')
    removeMode.click()
    await settleComponent()
    expect(removeMode.getAttribute('aria-pressed')).toBe('true')
    expect(buttonByAccessibleName(`${language.remove}: ${language.charIcon}`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.remove}: ${language.charIcon} 2`)).toBeTruthy()

    assetsTab.click()
    await settleComponent()
    expect(iconTab.getAttribute('aria-pressed')).toBe('false')
    expect(assetsTab.getAttribute('aria-pressed')).toBe('true')
    expect(buttonByAccessibleName(`${language.add}: ${language.additionalAssets}`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.remove}: portrait`)).toBeTruthy()
  })

  it('identifies repeated bias and alternate greeting actions by row', async () => {
    await mountCharConfig(2, {
      bias: [['token', 1]],
      alternateGreetings: ['First alternate', 'Second alternate'],
    })

    expect(buttonByAccessibleName(`${language.add}: Bias`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.remove}: Bias 1`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.add}: ${language.altGreet}`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.moveUp}: ${language.altGreet} 1`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.moveDown}: ${language.altGreet} 1`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.remove}: ${language.altGreet} 1`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.moveUp}: ${language.altGreet} 2`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.moveDown}: ${language.altGreet} 2`)).toBeTruthy()
    expect(buttonByAccessibleName(`${language.remove}: ${language.altGreet} 2`)).toBeTruthy()
  })
})

describe('CharConfig character media callback freshness contracts', () => {
  it('updates compact navigation icon sizing when the viewport crosses 360px', async () => {
    await mountCharConfig(0)
    MobileGUI.set(false)
    await settleComponent()

    const navigationUserIcon = () => target.querySelector<SVGElement>('svg.lucide-user')
    expect(navigationUserIcon()?.getAttribute('width')).toBe('24')

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 350 })
    window.dispatchEvent(new Event('resize'))
    await settleComponent()
    expect(navigationUserIcon()?.getAttribute('width')).toBe('20')

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    window.dispatchEvent(new Event('resize'))
    await settleComponent()
    expect(navigationUserIcon()?.getAttribute('width')).toBe('24')
  })

  it('routes VITS and GPT-SoVITS media buttons through guarded helper functions', () => {
    const source = charConfigSource()

    expect(source).toContain("from 'src/ts/server/characterTtsAssetUpload'")
    expect(source).toContain("import { registerOnnxModelFromFile } from 'src/ts/process/transformers'")
    expect(source).toContain('async function registerVitsModelFromEditor()')
    expect(source).toContain('async function uploadGptSoVitsReferenceAudioFromEditor()')
    expect(source).toContain('onclick={registerVitsModelFromEditor}')
    expect(source).toContain('onclick={uploadGptSoVitsReferenceAudioFromEditor}')
    expect(source).not.toContain('onclick={async () => {\n          const model = await registerOnnxModel()')
    expect(source).not.toContain("import { registerOnnxModel } from 'src/ts/process/transformers'")
  })

  it('issues additional asset upload tokens from the multi-file picker callback', () => {
    const source = charConfigSource()
    const body = sourceBetween(
      source,
      'async function uploadCharacterAdditionalAssetsFromEditor()',
      'function currentEditorTtsAssetUploadTarget(',
    )

    expect(body).toContain('const files = await selectMultipleFile(CHARACTER_ADDITIONAL_ASSET_EXTENSIONS, {')
    expect(body).toContain('onFilesSelected: () => {')
    expect(body).toContain('operation = beginCharacterAdditionalAssetUpload(target)')
    expect(body.indexOf('operation = beginCharacterAdditionalAssetUpload(target)')).toBeLessThan(
      body.indexOf('if (!files || files.length === 0 || !operation) return'),
    )
    expect(body).toContain('clearCharacterAdditionalAssetUpload(operation)')
  })

  it('issues notification-image tokens from the picker callback and guards the target fields', () => {
    const source = charConfigSource()
    const body = sourceBetween(
      source,
      'function currentEditorNotificationImageUploadTarget()',
      'function currentEditorTtsAssetUploadTarget(',
    )

    expect(body).toContain('rowNotificationImage: target.character.notificationImage')
    expect(body).toContain('draftNotificationImage: characterDraft.value.notificationImage')
    expect(body).toContain('const selected = (await selectSingleFile(NOTIFICATION_IMAGE_EXTENSIONS, {')
    expect(body).toContain('onFileSelected: () => {')
    expect(body).toContain('operation = beginCharacterNotificationImageUpload(target)')
    expect(body.indexOf('operation = beginCharacterNotificationImageUpload(target)')).toBeLessThan(
      body.indexOf('if (!selected || !operation) return'),
    )
    expect(body).toContain('if (!isCurrentEditorNotificationImageUpload(activeOperation)) return')
    expect(body).toContain('applyFreshCharacterNotificationImageUpload({')
    expect(body).toContain('clearCharacterNotificationImageUpload(operation)')
  })

  it('issues VITS tokens from the single-file picker callback and guards registration before final apply', () => {
    const source = charConfigSource()
    const body = sourceBetween(
      source,
      'async function registerVitsModelFromEditor()',
      'async function uploadGptSoVitsReferenceAudioFromEditor()',
    )

    expect(body).toContain("const selected = (await selectSingleFile(['zip'], {")
    expect(body).toContain('onFileSelected: () => {')
    expect(body).toContain('operation = beginCharacterTtsAssetUpload(target)')
    expect(body.indexOf('operation = beginCharacterTtsAssetUpload(target)')).toBeLessThan(
      body.indexOf('if (!selected || !operation) return'),
    )
    expect(body).toContain('if (!isCurrentEditorTtsAssetUpload(activeOperation)) return')
    expect(body).toContain('const model = await registerOnnxModelFromFile(selected, {')
    expect(body).toContain('shouldContinue: () => isCurrentEditorTtsAssetUpload(activeOperation)')
    expect(body).toContain('applyFreshCharacterVitsModelRegistration({')
    expect(body).toContain('character.vits = nextModel')
    expect(body).toContain('clearCharacterTtsAssetUpload(operation)')
    expect(body).not.toContain('character.vits = model')
  })

  it('issues GPT-SoVITS audio tokens from the single-file picker callback and guards saveAsset before final apply', () => {
    const source = charConfigSource()
    const body = sourceBetween(
      source,
      'async function uploadGptSoVitsReferenceAudioFromEditor()',
      'function clearOrRotateCharacterImage()',
    )

    expect(body).toContain("const audio = (await selectSingleFile(['wav', 'ogg', 'aac', 'mp3'], {")
    expect(body).toContain('onFileSelected: () => {')
    expect(body).toContain('operation = beginCharacterTtsAssetUpload(target)')
    expect(body.indexOf('operation = beginCharacterTtsAssetUpload(target)')).toBeLessThan(
      body.indexOf('if (!audio || !operation) return'),
    )
    expect(body).toContain('if (!isCurrentEditorTtsAssetUpload(activeOperation)) return')
    expect(body).toContain("const saveId = await saveAsset(audio.data, '', audio.name)")
    expect(body).toContain('applyFreshCharacterGptSoVitsReferenceAudioUpload({')
    expect(body).toContain('character.gptSoVitsConfig.ref_audio_data = nextRefAudioData')
    expect(body).toContain('clearCharacterTtsAssetUpload(operation)')
    expect(body).not.toContain('character.gptSoVitsConfig.ref_audio_data = {\n              fileName: audio.name')
  })

  it('keeps an older delayed VITS picker read from superseding a newer selection', async () => {
    const olderFile = selectedFile('older.zip', new Uint8Array([1]))
    const newerFile = selectedFile('newer.zip', new Uint8Array([2]))
    const olderRead = deferred<MockSelectedFile | null>()
    const newerRegistration = deferred<unknown>()
    selectedFileState.singleQueue.push({ selected: olderFile, result: olderRead.promise }, newerFile)
    transformerMocks.registerOnnxModelFromFileQueue.push(newerRegistration.promise)

    await mountCharConfig(5, {
      ttsMode: 'vits',
      vits: undefined,
    })

    buttonByText('Select Model').click()
    await settleComponent()
    expect(transformerMocks.registerOnnxModelFromFileCalls).toHaveLength(0)

    buttonByText('Select Model').click()
    await settleComponent()
    expect(transformerMocks.registerOnnxModelFromFileCalls).toHaveLength(1)
    expect(transformerMocks.registerOnnxModelFromFileCalls[0].file.name).toBe('newer.zip')

    olderRead.resolve(olderFile)
    await settleComponent()
    expect(transformerMocks.registerOnnxModelFromFileCalls).toHaveLength(1)

    newerRegistration.resolve({
      files: { 'model.onnx': 'newer-model-asset' },
      id: 'newer-model-id',
      name: 'newer-model',
    })
    await settleComponent()

    expect(getDatabase().characters[0].vits).toEqual({
      files: { 'model.onnx': 'newer-model-asset' },
      id: 'newer-model-id',
      name: 'newer-model',
    })
  })

  it('keeps an older delayed notification-image read from superseding a newer selection', async () => {
    const olderFile = selectedFile('older.png', new Uint8Array([1]))
    const newerFile = selectedFile('newer.png', new Uint8Array([2]))
    const olderRead = deferred<MockSelectedFile | null>()
    selectedFileState.singleQueue.push({ selected: olderFile, result: olderRead.promise }, newerFile)
    assetMocks.saveAsset.mockResolvedValueOnce('newer-notification-asset')

    await mountCharConfig(1, { notificationImage: 'original-notification-asset' })

    notificationImageAddButton().click()
    await settleComponent()
    expect(assetMocks.saveAsset).not.toHaveBeenCalled()

    notificationImageAddButton().click()
    await settleComponent()

    expect(assetMocks.saveAsset).toHaveBeenCalledTimes(1)
    expect(assetMocks.saveAsset).toHaveBeenCalledWith(newerFile.data, '', newerFile.name)
    expect(getDatabase().characters[0].notificationImage).toBe('newer-notification-asset')

    olderRead.resolve(olderFile)
    await settleComponent()

    expect(assetMocks.saveAsset).toHaveBeenCalledTimes(1)
    expect(getDatabase().characters[0].notificationImage).toBe('newer-notification-asset')
  })

  it('keeps a clear made while an older notification-image upload is pending', async () => {
    const olderFile = selectedFile('older.png', new Uint8Array([3]))
    const olderUpload = deferred<string>()
    selectedFileState.singleQueue.push(olderFile)
    assetMocks.saveAsset.mockReturnValueOnce(olderUpload.promise)

    await mountCharConfig(1, { notificationImage: 'original-notification-asset' })

    notificationImageAddButton().click()
    await settleComponent()

    expect(assetMocks.saveAsset).toHaveBeenCalledWith(olderFile.data, '', olderFile.name)

    notificationImageClearButton().click()
    await settleComponent()
    expect(getDatabase().characters[0].notificationImage).toBe('')

    olderUpload.resolve('older-notification-asset')
    await settleComponent()

    expect(getDatabase().characters[0].notificationImage).toBe('')
  })
})

describe('CharConfig Web Speech voice catalog', () => {
  it('renders and selects a voice that arrives after voiceschanged, then removes the listener', async () => {
    let voices: SpeechSynthesisVoice[] = []
    const synthesis = new EventTarget() as EventTarget & Pick<SpeechSynthesis, 'getVoices'>
    Object.defineProperty(synthesis, 'getVoices', {
      configurable: true,
      value: vi.fn(() => voices),
    })
    const addEventListener = vi.spyOn(synthesis, 'addEventListener')
    const removeEventListener = vi.spyOn(synthesis, 'removeEventListener')
    vi.stubGlobal('speechSynthesis', synthesis)

    await mountCharConfig(5, {
      ttsMode: 'webspeech',
      ttsSpeech: '',
    })

    expect(target.querySelector('option[value="Delayed Browser Voice"]')).toBeNull()
    expect(addEventListener).toHaveBeenCalledWith('voiceschanged', expect.any(Function))

    voices = [{ name: 'Delayed Browser Voice' } as SpeechSynthesisVoice]
    synthesis.dispatchEvent(new Event('voiceschanged'))
    await settleComponent()

    const delayedVoice = target.querySelector<HTMLOptionElement>('option[value="Delayed Browser Voice"]')
    expect(delayedVoice?.textContent).toBe('Delayed Browser Voice')

    const voiceSelect = delayedVoice?.closest('select') as HTMLSelectElement
    voiceSelect.value = 'Delayed Browser Voice'
    expect(delayedVoice?.disabled).toBe(false)
    expect(voiceSelect.value).toBe('Delayed Browser Voice')

    unmount(component as MountedComponent)
    component = undefined
    expect(removeEventListener).toHaveBeenCalledWith('voiceschanged', expect.any(Function))
  })
})

describe('CharConfig remote TTS catalogs', () => {
  it.each([
    { mode: 'elevenlab', load: () => ttsCatalogMocks.getElevenTTSVoices },
    { mode: 'fishspeech', load: () => ttsCatalogMocks.getFishSpeechModels },
  ])('contains a $mode catalog failure instead of rejecting the settings view', async ({ mode, load }) => {
    load().mockRejectedValueOnce(new Error('provider unavailable'))

    await mountCharConfig(5, { ttsMode: mode })

    expect(target.textContent).toContain('Unable to load the TTS voice catalog.')
  })

  it('keeps the TTS editor usable when an imported VOICEVOX speaker catalog is malformed', async () => {
    await mountCharConfig(5, {
      ttsMode: 'VOICEVOX',
      ttsSpeech: '',
      voicevoxConfig: {
        speaker: 'not-json',
        SPEED_SCALE: 1,
        PITCH_SCALE: 0,
        VOLUME_SCALE: 1,
        INTONATION_SCALE: 1,
      },
    })

    expect(target.querySelector('select[aria-label="Speaker"]')).toBeTruthy()
    expect(target.querySelector('select[aria-label="Style"]')).toBeTruthy()
    expect(target.querySelectorAll('select[aria-label="Style"] option')).toHaveLength(0)
  })
})

describe('CharConfig TTS control accessible names', () => {
  it('names the character identity fields from their visible settings', async () => {
    await mountCharConfig(0)

    const names = Array.from(target.querySelectorAll<HTMLElement>('input, textarea, [role="textbox"]'), (control) =>
      control.getAttribute('aria-label'),
    )

    expect(names).toEqual(
      expect.arrayContaining([
        'Character Name',
        language.displayName,
        language.description,
        language.firstMessage,
        language.customNotificationMessage,
      ]),
    )
  })

  it('keeps every direct shared form control named for its visible setting', () => {
    const source = charConfigSource()

    for (const componentName of ['TextInput', 'TextAreaInput', 'NumberInput', 'SelectInput', 'SecretInput']) {
      const tags = source.match(new RegExp(`<${componentName}\\b[\\s\\S]*?(?:\\/>|</${componentName}>)`, 'g')) ?? []
      expect(tags.length, componentName).toBeGreaterThan(0)
      expect(
        tags.filter((tag) => !tag.includes('ariaLabel=')),
        `${componentName} controls without names`,
      ).toEqual([])
    }
  })

  it.each([
    { mode: 'novelai', name: language.ttsCustomVoiceSeed },
    { mode: 'openai', name: language.ttsAdvancedEndpoint },
    { mode: 'fishspeech', name: language.ttsNormalize },
  ])('names the $mode option checkbox from its visible setting', async ({ mode, name }) => {
    await mountCharConfig(5, { ttsMode: mode })

    const checkbox = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')).find(
      (input) => input.getAttribute('aria-label') === name,
    )

    expect(checkbox, `checkbox named ${name}`).toBeTruthy()
    expect(target.textContent).toContain(name)
  })

  it('names every GPT-SoVITS range and option checkbox from its visible setting', async () => {
    await mountCharConfig(5, { ttsMode: 'gptsovits' })

    const sliderNames = Array.from(target.querySelectorAll<HTMLElement>('[role="slider"]'), (slider) =>
      slider.getAttribute('aria-label'),
    )
    const expectedSliderNames = [
      language.ttsVolume,
      language.modelProfiles.runtimeFields.topP,
      language.temperature,
      language.ttsSpeed,
      language.modelProfiles.runtimeFields.topK,
    ]
    expect(sliderNames).toEqual(expectedSliderNames)

    const checkboxNames = Array.from(target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'), (checkbox) =>
      checkbox.getAttribute('aria-label'),
    )
    for (const name of [language.ttsUseAutoPath, language.ttsUseLongAudio, language.ttsUseReferenceAudioScript]) {
      expect(checkboxNames).toContain(name)
      expect(target.textContent).toContain(name)
    }
  })
})

describe('CharConfig draft-backed avatar and emotion controls', () => {
  it('renders an alternate avatar rotation immediately and emits one debounced character patch', async () => {
    serverCommandState.enabled = true
    await mountCharConfig(1, {
      image: 'primary-avatar',
      ccAssets: [{ type: 'icon', name: 'alternate', uri: 'alternate-avatar', ext: 'png' }],
    })

    const alternateTile = Array.from(target.querySelectorAll<HTMLElement>('div.h-24.w-24.shadow-lg')).find((tile) =>
      tile.getAttribute('style')?.includes('alternate-avatar'),
    )
    expect(alternateTile).toBeTruthy()
    ;(alternateTile?.closest('button') as HTMLButtonElement).click()
    await settleComponent()

    const renderedAvatars = Array.from(target.querySelectorAll<HTMLElement>('div.h-24.w-24.shadow-lg')).map((tile) =>
      tile.getAttribute('style'),
    )
    expect(renderedAvatars[0]).toContain('alternate-avatar')
    expect(renderedAvatars[1]).toContain('primary-avatar')
    expect(getDatabase().characters[0]).toMatchObject({
      image: 'alternate-avatar',
      ccAssets: [{ type: 'icon', name: 'iconx', uri: 'primary-avatar', ext: 'png' }],
    })
    expect(serverCommandState.updateCharacterCalls).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(301)
    await settleComponent()

    expect(serverCommandState.updateCharacterCalls).toHaveLength(1)
    expect(serverCommandState.updateCharacterCalls[0]).toMatchObject({
      characterId: 'char-1',
      patch: {
        image: 'alternate-avatar',
        ccAssets: [{ type: 'icon', name: 'iconx', uri: 'primary-avatar', ext: 'png' }],
      },
    })
  })

  it('applies a guarded avatar selection to the draft, including PNG metadata', async () => {
    characterMediaMocks.selectCharacterAvatarImage.mockImplementationOnce(async (_index, onSelected) => {
      onSelected({
        image: 'uploaded-avatar',
        pngExif: { Description: 'uploaded metadata' },
      })
    })

    await mountCharConfig(1, {
      image: 'primary-avatar',
      ccAssets: [{ type: 'icon', name: 'prior', uri: 'prior-avatar', ext: 'png' }],
      extentions: { pngExif: { Title: 'existing metadata' } },
    })

    avatarAddButton().click()
    await settleComponent()

    expect(characterMediaMocks.selectCharacterAvatarImage).toHaveBeenCalledTimes(1)
    expect(getDatabase().characters[0]).toMatchObject({
      image: 'uploaded-avatar',
      ccAssets: [
        { type: 'icon', name: 'prior', uri: 'prior-avatar', ext: 'png' },
        { type: 'icon', name: 'iconx', uri: 'primary-avatar', ext: 'png' },
      ],
      extentions: {
        pngExif: {
          Title: 'existing metadata',
          Description: 'uploaded metadata',
        },
      },
    })
    expect(
      Array.from(target.querySelectorAll<HTMLElement>('div.h-24.w-24.shadow-lg'))[0].getAttribute('style'),
    ).toContain('uploaded-avatar')
  })

  it('renders emotion additions and deletions from the character draft immediately', async () => {
    selectedFileState.multipleQueue.push([selectedFile('happy.webp')])
    assetMocks.saveAsset.mockResolvedValueOnce('happy-upload')
    await mountCharConfig(1, { viewScreen: 'emotion' })
    await showCharacterViewScreen()

    emotionAddButton().click()
    await settleComponent()

    expect(assetMocks.saveAsset).toHaveBeenCalledWith(expect.any(Uint8Array), '', 'happy.webp')
    expect(target.querySelector('img[src="happy-upload"]')).toBeTruthy()
    expect(
      Array.from(target.querySelectorAll<HTMLInputElement>('input')).some((input) => input.value === 'happy'),
    ).toBe(true)
    expect(getDatabase().characters[0].emotionImages).toEqual([['happy', 'happy-upload']])

    const emotionRow = target.querySelector('img[src="happy-upload"]')?.closest('tr')
    ;(emotionRow?.querySelector('button') as HTMLButtonElement).click()
    await settleComponent()

    expect(target.querySelector('img[src="happy-upload"]')).toBeNull()
    expect(getDatabase().characters[0].emotionImages).toEqual([])
  })

  it('does not restore an emotion upload after the draft list changes while saving', async () => {
    const pendingUpload = deferred<string>()
    selectedFileState.multipleQueue.push([selectedFile('stale.gif')])
    assetMocks.saveAsset.mockReturnValueOnce(pendingUpload.promise)
    await mountCharConfig(1, {
      viewScreen: 'emotion',
      emotionImages: [['existing', 'existing-emotion']],
    })
    await showCharacterViewScreen()

    emotionAddButton().click()
    await settleComponent()
    expect(assetMocks.saveAsset).toHaveBeenCalledTimes(1)

    const existingRow = target.querySelector('img[src="existing-emotion"]')?.closest('tr')
    ;(existingRow?.querySelector('button') as HTMLButtonElement).click()
    await settleComponent()
    expect(getDatabase().characters[0].emotionImages).toEqual([])

    pendingUpload.resolve('stale-upload')
    await settleComponent()

    expect(target.querySelector('img[src="stale-upload"]')).toBeNull()
    expect(getDatabase().characters[0].emotionImages).toEqual([])
  })
})

describe('CharConfig character draft target guards', () => {
  it('does not gate persistent character actions on the profile draft type field', () => {
    const source = charConfigSource()

    expect(source).not.toContain('characterDraft.value.type')
    expect(source).toContain('function currentRealCharacterDraftTarget()')
    expect(source).toContain('isServerCharacterShell(selectedCharacter)')
    expect(source).toContain("selectedCharacter.type && selectedCharacter.type !== 'character'")
    expect(source).toContain('characterDraft.characterId !== selectedCharacter.chaId')
    expect(source).not.toContain('changeCharImage($selectedCharID')
    expect(source).not.toContain('rmCharEmotion($selectedCharID')
    expect(source).not.toContain('addCharEmotion($selectedCharID')
  })

  it('keeps script definitions out of the profile draft and validates the script draft target before adding', () => {
    const source = charConfigSource()
    const draftSeed = sourceBetween(
      source,
      'const characterDraft = createServerBackedCharacterDraft([',
      '  let characterScriptsDraft = $state<customscript[]>([])',
    )
    const scriptAddHandler = sourceBetween(
      source,
      '<span class="text-textcolor mt-4">{language.regexScript}',
      '<span class="text-textcolor mt-4">{language.triggerScript}',
    )

    expect(draftSeed).not.toContain("'type'")
    expect(draftSeed).not.toContain("'customscript'")
    expect(draftSeed).not.toContain("'triggerscript'")
    expect(scriptAddHandler).toContain('const target = currentRealCharacterDraftTarget()')
    expect(scriptAddHandler).toContain('scriptDraftCharacterId === target.character.chaId')
  })
})

describe('CharConfig draft-type-less character actions', () => {
  it('removes an additional asset without changing the active chat greeting', async () => {
    await mountCharConfig(1, {
      additionalAssets: [
        ['portrait', 'asset-1', 'png'],
        ['sticker', 'asset-2', 'png'],
      ],
    })

    buttonByText(language.additionalAssets).click()
    await settleComponent()
    buttonByAccessibleName(`${language.remove}: portrait`).click()
    await settleComponent()

    expect(chatCommandMocks.setCurrentChatGreetingIndex).not.toHaveBeenCalled()
    expect(getDatabase().characters[0].chats[0].fmIndex).toBe(2)
    expect(getDatabase().characters[0].additionalAssets).toEqual([['sticker', 'asset-2', 'png']])
  })

  it('adds a bias row when the live selected row is a real character', async () => {
    await mountCharConfig(2)

    expect(getDatabase().characters[0].bias).toEqual([])

    buttons()[0].click()
    await settleComponent()

    expect(getDatabase().characters[0].bias).toEqual([['', 0]])
  })

  it('adds and deletes alternate greetings using the validated selected index', async () => {
    await mountCharConfig(2, {
      alternateGreetings: ['Hello again'],
    })

    buttons()[1].click()
    await settleComponent()

    expect(getDatabase().characters[0].alternateGreetings).toEqual(['Hello again', ''])

    buttons()[4].click()
    await settleComponent()

    expect(chatCommandMocks.setCurrentChatGreetingIndex).toHaveBeenCalledWith(-1, {
      selectedChar: 0,
      dispatch: false,
    })
    expect(getDatabase().characters[0].chats[0].fmIndex).toBe(-1)
    expect(getDatabase().characters[0].alternateGreetings).toEqual([''])
  })

  it('adds a regex script row when the script draft still targets the selected character', async () => {
    await mountCharConfig(4)

    expect(target.querySelector('[data-testid="regex-count"]')?.textContent).toBe('0')

    buttons()[0].click()
    await settleComponent()

    expect(target.querySelector('[data-testid="regex-count"]')?.textContent).toBe('1')
    expect(getDatabase().characters[0].customscript).toHaveLength(1)
    expect(getDatabase().characters[0].customscript[0]).toMatchObject({
      comment: '',
      in: '',
      out: '',
      type: 'editinput',
    })
  })

  it('merges imported regex rows into edits made while the picker is open', async () => {
    const pendingImport = deferred<unknown[] | null>()
    regexImportMocks.importRegexRows.mockReturnValue(pendingImport.promise)
    await mountCharConfig(4)

    buttonByAccessibleName(`${language.import}: ${language.regexScript}`).click()
    expect(regexImportMocks.importRegexRows).toHaveBeenCalledOnce()
    buttonByAccessibleName(`${language.add}: ${language.regexScript}`).click()
    await settleComponent()

    pendingImport.resolve([{ id: 'imported-script', comment: 'Imported', in: 'hello', out: 'hi', type: 'editinput' }])
    await settleComponent()

    expect(getDatabase().characters[0].customscript).toHaveLength(2)
    expect(getDatabase().characters[0].customscript[0]).toMatchObject({ comment: '', type: 'editinput' })
    expect(getDatabase().characters[0].customscript[1]).toMatchObject({
      id: 'imported-script',
      comment: 'Imported',
    })
  })

  it('discards a regex import when character ownership changes while the picker is open', async () => {
    const pendingImport = deferred<unknown[] | null>()
    regexImportMocks.importRegexRows.mockReturnValue(pendingImport.promise)
    await mountCharConfig(4)

    buttonByAccessibleName(`${language.import}: ${language.regexScript}`).click()
    expect(regexImportMocks.importRegexRows).toHaveBeenCalledOnce()
    getDatabase().characters.push(makeCharacter({ chaId: 'char-2', name: 'Character B' }))
    selectedCharID.set(1)
    await settleComponent()

    pendingImport.resolve([{ id: 'stale-import', comment: 'Wrong owner', in: 'hello', out: 'hi', type: 'editinput' }])
    await settleComponent()

    expect(getDatabase().characters[0].customscript).toEqual([])
    expect(getDatabase().characters[1].customscript).toEqual([])
  })

  it('shows background, regex, and trigger scripts for a typeless real character row', async () => {
    await mountCharConfig(4, {
      type: undefined,
      backgroundHTML: '<style>.chattext .name { color: red; }</style>',
      lowLevelAccess: true,
      customscript: [{ id: 'script-1', comment: 'Regex', in: 'hello', out: 'hi', type: 'editinput' }],
      triggerscript: [
        {
          id: 'trigger-1',
          comment: 'Lua/V2 trigger',
          type: 'start',
          conditions: [],
          effect: [],
        } as never,
      ],
    })

    expect(target.querySelector('[data-testid="regex-count"]')?.textContent).toBe('1')
    const triggerCount = target.querySelector('[data-testid="trigger-count"]')
    expect(triggerCount?.textContent).toBe('1')
    expect(triggerCount?.getAttribute('data-low-level')).toBe('true')
    expect(Array.from(target.querySelectorAll('textarea')).some((input) => input.value.includes('.chattext'))).toBe(
      true,
    )

    buttons()[0].click()
    await settleComponent()

    expect(target.querySelector('[data-testid="regex-count"]')?.textContent).toBe('2')
    expect(getDatabase().characters[0].customscript).toHaveLength(2)
  })
})
