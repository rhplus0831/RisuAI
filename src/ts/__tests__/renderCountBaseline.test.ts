import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRenderCostHarness } from './renderCostHarness'

const BASELINE_MESSAGE_COUNT = 5

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'render-count-baseline-token',
}))

vi.mock('../process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../process/modules')>()
  return {
    ...actual,
    getModuleAssets: () => [],
    getModuleLorebooks: () => [],
    getModuleRegexScripts: () => [],
    getModuleTriggers: () => [],
    getModules: () => [],
    moduleUpdate: () => {},
  }
})

vi.mock('../process/scriptings', async (importActual) => {
  const actual = await importActual<typeof import('../process/scriptings')>()
  return {
    ...actual,
    runLuaEditTrigger: vi.fn(async (_char: unknown, _mode: unknown, data: string) => data),
  }
})

vi.mock('../process/triggers', async (importActual) => {
  const actual = await importActual<typeof import('../process/triggers')>()
  return {
    ...actual,
    runTrigger: vi.fn(async () => undefined),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('H3 var-only GUI reload narrowing', () => {
  it('H3: var-only GUI refresh does not remount/reparse mounted chat messages or reset script caches', async () => {
    const result = await runRenderCostHarness({
      messageCount: BASELINE_MESSAGE_COUNT,
      reloadKind: 'variable-only',
    })

    expect(result.mountedMessages).toBe(BASELINE_MESSAGE_COUNT)
    expect(result.visibleMessageTexts).toHaveLength(BASELINE_MESSAGE_COUNT)

    expect({
      parseMarkdown: result.parsesAfterBump.parseMarkdown,
      risuChatParser: result.parsesAfterBump.risuChatParser,
      editDisplay: result.parsesAfterBump.editDisplay,
      editDisplayRunsAfterBump: result.editDisplayRunsAfterBump,
    }).toEqual({
      parseMarkdown: 0,
      risuChatParser: 0,
      editDisplay: 0,
      editDisplayRunsAfterBump: 0,
    })

    expect(result.cacheWarmBeforeBump).toBe(true)
    expect(result.cacheWiped).toBe(false)
    expect(result.cacheProof).toMatchObject({
      regexCacheWarmBeforeBump: true,
      regexCacheWipedAfterBump: false,
      scriptCacheWarmBeforeBump: true,
      scriptCacheWipedAfterBump: false,
    })
  }, 60000)
})
