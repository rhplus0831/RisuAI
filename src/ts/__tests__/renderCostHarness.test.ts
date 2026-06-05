import { afterEach, describe, expect, it, vi } from 'vitest'
import { runRenderCostHarness } from './renderCostHarness'

vi.mock('../platform', async (importActual) => {
  const actual = await importActual<typeof import('../platform')>()
  return { ...actual, isFastifyServer: true }
})

vi.mock('../storage/fastifyStorage', () => ({
  getNodeServerProxyAuth: async () => 'render-cost-harness-token',
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

describe('render-count harness', () => {
  it('drives a variable-only GUI refresh without reparsing mounted chat messages or resetting caches', async () => {
    const messageCount = 4
    const result = await runRenderCostHarness({ messageCount, reloadKind: 'variable-only' })

    expect(result.mountedMessages).toBe(messageCount)
    expect(result.visibleMessageTexts).toHaveLength(messageCount)
    expect(result.parsesBeforeBump.parseMarkdown).toBeGreaterThanOrEqual(messageCount)
    expect(result.parsesBeforeBump.risuChatParser).toBeGreaterThanOrEqual(messageCount)
    expect(result.parsesAfterBump.parseMarkdown).toBe(0)
    expect(result.parsesAfterBump.risuChatParser).toBe(0)
    expect(result.editDisplayRunsAfterBump).toBe(0)
    expect(result.cacheWarmBeforeBump).toBe(true)
    expect(result.cacheWiped).toBe(false)
    expect(result.cacheProof).toMatchObject({
      regexCacheWarmBeforeBump: true,
      regexCacheWipedAfterBump: false,
      scriptCacheWarmBeforeBump: true,
      scriptCacheWipedAfterBump: false,
    })
  }, 60000)

  it('drives a definition-level GUI reload that reparses mounted chat messages and resets caches', async () => {
    const messageCount = 4
    const result = await runRenderCostHarness({ messageCount, reloadKind: 'definition' })

    expect(result.mountedMessages).toBe(messageCount)
    expect(result.visibleMessageTexts).toHaveLength(messageCount)
    expect(result.parsesAfterBump.parseMarkdown).toBeGreaterThanOrEqual(messageCount)
    expect(result.parsesAfterBump.risuChatParser).toBeGreaterThanOrEqual(messageCount)
    expect(result.editDisplayRunsAfterBump).toBeGreaterThanOrEqual(messageCount)
    expect(result.cacheWarmBeforeBump).toBe(true)
    expect(result.cacheWiped).toBe(true)
    expect(result.cacheProof).toMatchObject({
      regexCacheWarmBeforeBump: true,
      regexCacheWipedAfterBump: true,
      scriptCacheWarmBeforeBump: true,
      scriptCacheWipedAfterBump: true,
    })
  }, 60000)

  it('drives a scripting display reload that reparses broadly while preserving script caches', async () => {
    const messageCount = 4
    const result = await runRenderCostHarness({ messageCount, reloadKind: 'display' })

    expect(result.mountedMessages).toBe(messageCount)
    expect(result.visibleMessageTexts).toHaveLength(messageCount)
    expect(result.parsesAfterBump.parseMarkdown).toBeGreaterThanOrEqual(messageCount)
    expect(result.parsesAfterBump.risuChatParser).toBeGreaterThanOrEqual(messageCount)
    expect(result.editDisplayRunsAfterBump).toBeGreaterThanOrEqual(messageCount)
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
