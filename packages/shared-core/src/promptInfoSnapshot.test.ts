import { describe, expect, it } from 'vitest'
import { createPromptInfoSnapshot } from './promptInfoSnapshot.js'

describe('prompt info snapshot', () => {
  it('returns an empty snapshot when capture is disabled', () => {
    expect(
      createPromptInfoSnapshot({
        enabled: false,
        promptPreset: { name: 'Ignored' },
        requiredSidebarToggles: [],
      }),
    ).toEqual({})
  })

  it('formats select, text, textarea, and enabled boolean toggles in source order', () => {
    expect(
      createPromptInfoSnapshot({
        enabled: true,
        promptPreset: { name: 'Chat Preset' },
        requiredSidebarToggles: [
          { key: 'tone', label: 'Tone', kind: 'select', options: ['Warm', 'Cold'] },
          { key: 'custom', label: 'Custom', kind: 'select', options: [] },
          { key: 'text', label: 'Text', kind: 'text', options: [] },
          { key: 'notes', label: 'Notes', kind: 'textarea', options: [] },
          { key: 'enabled', label: 'Enabled', kind: 'boolean', options: [] },
          { key: 'disabled', label: 'Disabled', kind: 'boolean', options: [] },
          { key: 'missing', label: 'Missing', kind: 'text', options: [] },
        ],
        sidebarToggles: {
          tone: '1',
          custom: 'literal',
          text: 'short',
          notes: 'long',
          enabled: '1',
          disabled: '0',
        },
      }),
    ).toEqual({
      promptName: 'Chat Preset',
      promptToggles: [
        { key: 'Tone', value: 'Cold' },
        { key: 'Custom', value: 'literal' },
        { key: 'Text', value: 'short' },
        { key: 'Notes', value: 'long' },
        { key: 'Enabled', value: 'ON' },
      ],
    })
  })

  it('coerces missing preset names and toggle values without inventing rows', () => {
    expect(
      createPromptInfoSnapshot({
        enabled: true,
        promptPreset: null,
        requiredSidebarToggles: [
          { key: 'select', label: 'Select', kind: 'select', options: ['A'] },
          { key: 'text', label: 'Text', kind: 'text', options: [] },
          { key: 'boolean', label: 'Boolean', kind: 'boolean', options: [] },
        ],
      }),
    ).toEqual({ promptName: '', promptToggles: [] })
  })
})
