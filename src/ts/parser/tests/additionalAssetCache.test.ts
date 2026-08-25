import { writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMModel } from '../../model/modellist'
import { clearAdditionalAssetCachesForTests, ParseMarkdown, type simpleCharacterArgument } from '../parser.svelte'

const mocks = vi.hoisted(() => ({
  db: {
    assetMaxDifference: 4,
    characters: [] as Array<{ chaId?: string }>,
    customQuotes: false,
    hideAllImages: false,
  },
  getFileSrc: vi.fn<(path: string) => Promise<string>>(),
  moduleAssets: [] as [string, string, string][],
  processScriptFull: vi.fn(async (_char: unknown, data: string) => ({ data, emoChanged: false })),
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
    }) as typeof import('../../storage/database.svelte'),
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
  mocks.moduleAssets = []
  mocks.getFileSrc.mockReset().mockImplementation(async (path) => `/resolved/${path}`)
  mocks.processScriptFull.mockReset().mockImplementation(async (_char, data) => ({ data, emoChanged: false }))
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

    await expect(ParseMarkdown('{{raw::portrait}} {{raw::frame}}', character, 'back')).resolves.toContain(
      '/resolved/character-old',
    )

    character.additionalAssets![0][1] = 'character-new'
    mocks.moduleAssets[0][1] = 'module-new'
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
})
