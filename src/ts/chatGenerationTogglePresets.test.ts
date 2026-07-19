import { describe, expect, it, vi } from 'vitest'

vi.mock('./process/modules', () => ({
  exportModule: vi.fn(),
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleMcps: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModuleToggles: vi.fn(() => ''),
  getModuleTriggers: vi.fn(() => []),
  getModules: vi.fn(() => []),
  importModule: vi.fn(),
  moduleUpdate: vi.fn(),
  readModule: vi.fn(),
  refreshModules: vi.fn(),
}))

vi.mock('./process/scripts', () => ({
  resetScriptCache: vi.fn(),
}))
import {
  createChatGenerationTogglePresetPickValues,
  getChatGenerationTogglePresetPickEligibility,
  sortChatGenerationTogglePresetsBySimilarity,
  type ChatGenerationTogglePreset,
} from './chatGenerationTogglePresets'
import { normalizeChatGenerationTogglePresets } from './chatGenerationTogglePresetRecords'

function preset(
  id: string,
  name: string,
  sidebarToggles: Record<string, string>,
  sidebarToggleKinds: ChatGenerationTogglePreset['sidebarToggleKinds'],
  updatedAt = 1,
): ChatGenerationTogglePreset {
  return { id, name, createdAt: 1, updatedAt, sidebarToggles, sidebarToggleKinds }
}

describe('Saved Toggles domain helpers', () => {
  it('penalizes stale keys in Jaccard similarity', () => {
    const exact = preset('exact', 'Exact', { a: '0', b: '0' }, { a: 'boolean', b: 'boolean' })
    const stale = preset('stale', 'Stale', { a: '0', b: '0', c: '0' }, { a: 'boolean', b: 'boolean', c: 'boolean' })

    expect(
      sortChatGenerationTogglePresetsBySimilarity(
        [stale, exact],
        [
          { key: 'a', kind: 'boolean', value: '0' },
          { key: 'b', kind: 'boolean', value: '0' },
        ],
      ).map((candidate) => candidate.id),
    ).toEqual(['exact', 'stale'])
  })

  it('uses boolean active-count distance after similarity', () => {
    const near = preset('near', 'Near', { a: '1', b: '0' }, { a: 'boolean', b: 'boolean' })
    const far = preset('far', 'Far', { a: '0', b: '0' }, { a: 'boolean', b: 'boolean' })

    expect(
      sortChatGenerationTogglePresetsBySimilarity(
        [far, near],
        [
          { key: 'a', kind: 'boolean', value: '1' },
          { key: 'b', kind: 'boolean', value: '0' },
        ],
      ).map((candidate) => candidate.id),
    ).toEqual(['near', 'far'])
  })

  it('uses updatedAt descending and then name ascending deterministically', () => {
    const older = preset('older', 'Aardvark', {}, {}, 2)
    const zulu = preset('zulu', 'Zulu', {}, {}, 3)
    const alpha = preset('alpha', 'Alpha', {}, {}, 3)

    expect(
      sortChatGenerationTogglePresetsBySimilarity([older, zulu, alpha], []).map((candidate) => candidate.id),
    ).toEqual(['alpha', 'zulu', 'older'])
  })

  it('requires every Pick key, honors recorded kinds, and copies exactly the source keys', () => {
    const source = [
      { key: 'a', kind: 'boolean' as const },
      { key: 'b', kind: 'text' as const },
    ]
    const missing = preset('missing', 'Missing', { a: '1' }, { a: 'boolean' })
    const mismatch = preset('mismatch', 'Mismatch', { a: '1', b: 'value' }, { a: 'select', b: 'text' })
    const eligible = preset(
      'eligible',
      'Eligible',
      { a: '1', b: 'value', unrelated: 'untouched' },
      { a: 'boolean', unrelated: 'text' },
    )

    expect(getChatGenerationTogglePresetPickEligibility(missing, source)).toMatchObject({
      eligible: false,
      missingSidebarToggleKeys: ['b'],
    })
    expect(getChatGenerationTogglePresetPickEligibility(mismatch, source)).toMatchObject({
      eligible: false,
      kindMismatchSidebarToggleKeys: ['a'],
    })
    expect(getChatGenerationTogglePresetPickEligibility(eligible, source).eligible).toBe(true)
    expect(createChatGenerationTogglePresetPickValues(eligible, source)).toEqual({ a: '1', b: 'value' })
  })

  it('drops legacy jailbreakToggle data while normalizing records', () => {
    expect(
      normalizeChatGenerationTogglePresets([
        {
          id: 'legacy',
          name: 'Legacy',
          createdAt: 1,
          updatedAt: 2,
          jailbreakToggle: true,
          sidebarToggles: { a: '1' },
          sidebarToggleKinds: { a: 'boolean' },
        },
      ])[0],
    ).not.toHaveProperty('jailbreakToggle')
  })
})
