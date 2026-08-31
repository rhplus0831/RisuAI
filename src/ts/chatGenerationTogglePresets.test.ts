// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'

import {
  compareChatGenerationTogglePresetToActiveState,
  createChatGenerationTogglePresetPickValues,
  createSidebarToggleValuesForActiveChat,
  getChatGenerationTogglePresetPickEligibility,
  sortChatGenerationTogglePresetsBySimilarity,
  type ChatGenerationTogglePreset,
} from './chatGenerationTogglePresetPlanning'
import { normalizeChatGenerationTogglePresets } from './chatGenerationTogglePresetRecords'
import { getChatGenerationTogglePresets } from './chatGenerationTogglePresets'
import { replaceResourceDatabase, settingsResourceState } from './server/resourceState.svelte'
import type { Database } from './storage/database.svelte'

function preset(
  id: string,
  name: string,
  sidebarToggles: Record<string, string>,
  sidebarToggleKinds: ChatGenerationTogglePreset['sidebarToggleKinds'],
  updatedAt = 1,
): ChatGenerationTogglePreset {
  return { id, name, createdAt: 1, updatedAt, sidebarToggles, sidebarToggleKinds }
}

beforeEach(() => {
  replaceResourceDatabase({ chatGenerationTogglePresets: [] } as unknown as Database)
})

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

  it('reports missing, stale, kind-mismatched, and value-mismatched active fields', () => {
    const saved = preset(
      'saved',
      'Saved',
      { boolean: '0', text: 'saved', stale: '1' },
      { boolean: 'select', text: 'text', stale: 'boolean' },
    )
    const comparison = compareChatGenerationTogglePresetToActiveState(saved, {
      settings: { sidebarToggles: { boolean: '1', text: 'live', missing: 'value' } },
      requiredSidebarToggles: [
        { key: 'boolean', label: 'Boolean', kind: 'boolean', options: [], source: 'preset' },
        { key: 'text', label: 'Text', kind: 'text', options: [], source: 'preset' },
        { key: 'missing', label: 'Missing', kind: 'text', options: [], source: 'preset' },
      ],
    })

    expect(comparison.hasAnyDifference).toBe(true)
    expect(comparison.hasToggleTypeMismatch).toBe(true)
    expect([...comparison.differingSidebarToggleKeys]).toEqual(['boolean', 'text', 'missing'])
    expect(comparison.missingSidebarToggleKeys).toEqual(['missing'])
    expect(comparison.staleSidebarToggleKeys).toEqual(['stale'])
    expect(comparison.kindMismatchSidebarToggleKeys).toEqual(['boolean'])
  })

  it('projects only active keys and supplies kind-specific defaults', () => {
    const saved = preset('saved', 'Saved', { selected: 'warm', stale: '1' }, { selected: 'select' })

    expect(
      createSidebarToggleValuesForActiveChat(saved, {
        requiredSidebarToggles: [
          {
            key: 'selected',
            label: 'Selected',
            kind: 'select',
            source: 'preset',
            options: ['warm', 'cold'],
          },
          { key: 'boolean', label: 'Boolean', kind: 'boolean', options: [], source: 'preset' },
          { key: 'text', label: 'Text', kind: 'text', options: [], source: 'preset' },
        ],
      }),
    ).toEqual({ selected: 'warm', boolean: '0', text: '' })
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

  it('reads canonical toggle presets from the ready sidebar settings owner', () => {
    const saved = preset('saved', 'Saved', { flag: '1' }, { flag: 'boolean' })
    settingsResourceState.value.chatGenerationTogglePresets = [saved]

    expect(getChatGenerationTogglePresets()).toEqual([saved])
  })

  it.each(['idle', 'loading'] as const)('does not read retained presets while the sidebar owner is %s', (status) => {
    const saved = preset('saved', 'Saved', { flag: '1' }, { flag: 'boolean' })
    settingsResourceState.value.chatGenerationTogglePresets = [saved]
    settingsResourceState.groupStatuses.sidebar = status

    expect(getChatGenerationTogglePresets()).toEqual([])
  })

  it('fails closed for duplicate preset ids or an errored ready owner', () => {
    const saved = preset('saved', 'Saved', { flag: '1' }, { flag: 'boolean' })
    settingsResourceState.value.chatGenerationTogglePresets = [saved, { ...saved, name: 'Duplicate' }]

    expect(getChatGenerationTogglePresets()).toEqual([])

    settingsResourceState.value.chatGenerationTogglePresets = [saved]
    settingsResourceState.groupStatuses.sidebar = 'error'
    settingsResourceState.groupErrors.sidebar = 'forced sidebar owner failure'

    expect(getChatGenerationTogglePresets()).toEqual([])
  })
})
