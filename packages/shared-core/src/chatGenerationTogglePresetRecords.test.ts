import { describe, expect, it } from 'vitest'
import {
  cloneChatGenerationTogglePreset,
  normalizeChatGenerationTogglePresets,
} from './chatGenerationTogglePresetRecords.js'

describe('chat generation toggle preset records', () => {
  it('normalizes identities, values, kinds, and timestamps', () => {
    expect(
      normalizeChatGenerationTogglePresets([
        {
          id: 'preset-a',
          name: '',
          createdAt: 10,
          sidebarToggles: { enabled: '1', ignored: 1 },
          sidebarToggleKinds: { enabled: 'boolean', ignored: 'unknown' },
        },
        { id: 'preset-a', name: 'Duplicate' },
      ]),
    ).toEqual([
      {
        id: 'preset-a',
        name: 'Toggle Preset 1',
        createdAt: 10,
        updatedAt: 10,
        sidebarToggles: { enabled: '1' },
        sidebarToggleKinds: { enabled: 'boolean' },
      },
    ])
  })

  it('clones nested toggle records', () => {
    const source = normalizeChatGenerationTogglePresets([
      {
        id: 'preset-a',
        name: 'A',
        sidebarToggles: { enabled: '1' },
        sidebarToggleKinds: { enabled: 'boolean' },
      },
    ])[0]
    const cloned = cloneChatGenerationTogglePreset(source)

    expect(cloned).toEqual(source)
    expect(cloned).not.toBe(source)
    expect(cloned.sidebarToggles).not.toBe(source.sidebarToggles)
    expect(cloned.sidebarToggleKinds).not.toBe(source.sidebarToggleKinds)
  })
})
