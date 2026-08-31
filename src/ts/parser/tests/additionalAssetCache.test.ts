import { writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMModel } from '../../model/modellist'
import { clearAdditionalAssetCachesForTests, ParseMarkdown, type simpleCharacterArgument } from '../parser.svelte'
import {
  charactersResourceState,
  collectionsResourceState,
  settingsResourceState,
} from '../../server/resourceState.svelte'

const mocks = vi.hoisted(() => ({
  db: {
    assetMaxDifference: 4,
    characters: [] as Array<{ chaId?: string }>,
    customQuotes: false,
    enabledModules: ['module-owner'],
    hideAllImages: false,
    modules: [] as Array<{
      id: string
      name: string
      description: string
      assets: [string, string, string][]
    }>,
    promptPresets: [],
    personas: [],
    agentPresets: [],
  },
  getFileSrc: vi.fn<(path: string) => Promise<string>>(),
  moduleAssets: [] as [string, string, string][],
  processScriptFull: vi.fn(async (_char: unknown, data: string) => ({ data, emoChanged: false })),
  requestServerDisplaySource: vi.fn(async () => ({ status: 'fallback' as const, reason: 'test' })),
  modelInfo: {
    id: 'test-model',
    name: 'Test Model',
    provider: 14,
    flags: [],
    format: 19,
    parameters: [],
    tokenizer: 0,
  } satisfies LLMModel,
}))

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => undefined,
      getCurrentChat: () => undefined,
      getDatabase: () => mocks.db,
      reapplyPendingPresetProjections: () => {},
    }) as unknown as typeof import('../../storage/database.svelte'),
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: mocks.getFileSrc,
}))

vi.mock(import('../../stores.svelte'), () => ({
  CurrentTriggerIdStore: writable(null),
  selectedCharID: writable(0),
}))

vi.mock(import('../../process/files/inlays'), () => ({
  getInlayAssetBlob: vi.fn(),
}))

vi.mock(import('../../process/modules'), () => ({
  getModuleAssets: () => mocks.moduleAssets,
  getModuleLorebooks: () => [],
  getModules: () => [],
}))

vi.mock(import('../../process/scripts'), () => ({
  processScriptFull: mocks.processScriptFull,
}))

vi.mock(import('../../server/displaySources'), () => ({
  requestServerDisplaySource: mocks.requestServerDisplaySource,
}))

vi.mock(import('../../model/modellist'), () => ({
  getModelInfo: () => mocks.modelInfo,
}))

function simpleCharacter(
  chaId: string,
  additionalAssets: [string, string, string][] = [],
  emotionImages: [string, string][] = [],
): simpleCharacterArgument {
  return {
    type: 'simple',
    chaId,
    additionalAssets,
    emotionImages,
    customscript: [],
    triggerscript: [],
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  clearAdditionalAssetCachesForTests()
  mocks.db.assetMaxDifference = 4
  mocks.db.characters = []
  mocks.db.modules = []
  mocks.moduleAssets = []
  mocks.getFileSrc.mockReset().mockImplementation(async (path) => `/resolved/${path}`)
  mocks.processScriptFull.mockReset().mockImplementation(async (_char, data) => ({ data, emoChanged: false }))
  mocks.requestServerDisplaySource.mockClear()
  charactersResourceState.characters = []
  charactersResourceState.currentChar = -1
  charactersResourceState.status = 'idle'
  settingsResourceState.value = mocks.db
  settingsResourceState.status = 'ready'
  settingsResourceState.groupStatuses = { advanced: 'ready', display: 'ready', modules: 'ready' }
  settingsResourceState.standaloneStatuses = {}
  collectionsResourceState.values = {
    modules: mocks.db.modules,
    promptPresets: [],
    personas: [],
  }
  collectionsResourceState.statuses = { modules: 'ready', promptPresets: 'ready', personas: 'ready' }
  collectionsResourceState.status = 'ready'
})

describe('additional asset resolution cache', () => {
  it('resolves colliding names from the character passed to ParseMarkdown', async () => {
    const lucy = simpleCharacter('lucy', [['bg', 'lucy-background', 'png']])
    const haniel = simpleCharacter('haniel', [['bg.png', 'haniel-background', 'png']])

    const lucyOutput = await ParseMarkdown('{{raw::bg}}', lucy, 'back')
    const hanielOutput = await ParseMarkdown('{{raw::bg}}', haniel, 'back')

    expect(lucyOutput).toContain('/resolved/lucy-background')
    expect(hanielOutput).toContain('/resolved/haniel-background')
    expect(hanielOutput).not.toContain('/resolved/lucy-background')
  })

  it('invalidates character and module asset entries after in-place tuple changes', async () => {
    const character = simpleCharacter('mutable-character', [['portrait', 'character-old', 'png']])
    mocks.moduleAssets = [['frame', 'module-old', 'png']]
    mocks.db.modules = [
      {
        id: 'module-owner',
        name: 'Module owner',
        description: '',
        assets: mocks.moduleAssets,
      },
    ]
    collectionsResourceState.values.modules = mocks.db.modules as never

    await expect(ParseMarkdown('{{raw::portrait}} {{raw::frame}}', character, 'back')).resolves.toContain(
      '/resolved/character-old',
    )

    character.additionalAssets![0][1] = 'character-new'
    collectionsResourceState.values.modules![0].assets![0][1] = 'module-new'
    const updated = await ParseMarkdown('{{raw::portrait}} {{raw::frame}}', character, 'back')

    expect(updated).toContain('/resolved/character-new')
    expect(updated).toContain('/resolved/module-new')
    expect(updated).not.toContain('/resolved/character-old')
    expect(updated).not.toContain('/resolved/module-old')
  })

  it('keeps concurrent character parses isolated when asset reads finish out of order', async () => {
    const lucyRead = deferred<string>()
    const hanielRead = deferred<string>()
    mocks.getFileSrc.mockImplementation((path) => {
      if (path === 'lucy-concurrent') return lucyRead.promise
      if (path === 'haniel-concurrent') return hanielRead.promise
      return Promise.resolve('')
    })
    const lucy = simpleCharacter('lucy-concurrent', [['bg', 'lucy-concurrent', 'png']])
    const haniel = simpleCharacter('haniel-concurrent', [['bg.png', 'haniel-concurrent', 'png']])

    const lucyParse = ParseMarkdown('{{raw::bg}}', lucy, 'back')
    await vi.waitFor(() => expect(mocks.getFileSrc).toHaveBeenCalledWith('lucy-concurrent'))
    const hanielParse = ParseMarkdown('{{raw::bg}}', haniel, 'back')
    await vi.waitFor(() => expect(mocks.getFileSrc).toHaveBeenCalledWith('haniel-concurrent'))

    hanielRead.resolve('/resolved/haniel-concurrent')
    await expect(hanielParse).resolves.toContain('/resolved/haniel-concurrent')
    lucyRead.resolve('/resolved/lucy-concurrent')
    await expect(lucyParse).resolves.toContain('/resolved/lucy-concurrent')
  })

  it('uses ready module and generation-context owners instead of compatibility rows', async () => {
    mocks.db.modules = [
      {
        id: 'module-owner',
        name: 'Compatibility module',
        description: '',
        assets: [['frame', 'compatibility-frame', 'png']],
      },
    ]
    charactersResourceState.characters = [
      {
        chaId: 'owner-character',
        type: 'character',
        chatPage: 0,
        chats: [
          {
            id: 'owner-chat',
            message: [{ role: 'char', data: 'owner row', chatId: 'owner-message' }],
            scriptstate: {},
          },
        ],
      },
    ] as never
    charactersResourceState.currentChar = 0
    charactersResourceState.status = 'ready'
    settingsResourceState.value = { enabledModules: ['module-owner'], agentPresets: [] }
    settingsResourceState.status = 'ready'
    settingsResourceState.groupStatuses.modules = 'ready'
    collectionsResourceState.values = {
      modules: [
        {
          id: 'module-owner',
          name: 'Owner module',
          description: '',
          assets: [['frame', 'owner-frame', 'png']],
        },
        {
          id: 'module-generation',
          name: 'Generation module',
          description: '',
          assets: [['generation', 'generation-frame', 'png']],
        },
      ],
      promptPresets: [],
      personas: [],
    } as never
    collectionsResourceState.statuses = {
      modules: 'ready',
      promptPresets: 'ready',
      personas: 'ready',
    }
    collectionsResourceState.status = 'ready'

    const output = await ParseMarkdown('{{raw::frame}}', simpleCharacter('owner-character'), 'back', 0)

    expect(output).toContain('/resolved/owner-frame')
    expect(output).not.toContain('compatibility-frame')
    expect(mocks.requestServerDisplaySource).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 'owner-chat',
        messageId: 'owner-message',
        index: 0,
      }),
    )

    const generationOutput = await ParseMarkdown(
      '{{raw::generation}}',
      {
        type: 'character',
        chaId: 'owner-character',
        chatPage: 0,
        chats: [{ id: 'generation-chat', message: [], scriptstate: {} }],
        modules: ['module-generation'],
        additionalAssets: [],
        emotionImages: [],
        customscript: [],
        triggerscript: [],
      } as never,
      'back',
      0,
    )
    expect(generationOutput).toContain('/resolved/generation-frame')
  })
})
