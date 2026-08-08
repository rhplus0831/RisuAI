import { describe, expect, it, vi } from 'vitest'

vi.mock('../gui/heightMode', () => ({ updateHeightMode: vi.fn() }))

import { advancedSettingsItems } from './advancedSettingsData'

describe('advanced settings data', () => {
  it('includes configurable initial and additional chat load counts', () => {
    expect(advancedSettingsItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'adv.chatLoadInitial',
          type: 'number',
          bindKey: 'chatLoadInitialPages',
          helpKey: 'chatLoadInitialPages',
          options: { min: 1 },
        }),
        expect.objectContaining({
          id: 'adv.chatLoadAdditional',
          type: 'number',
          bindKey: 'chatLoadAdditionalPages',
          helpKey: 'chatLoadAdditionalPages',
          options: { min: 1 },
        }),
      ]),
    )
  })

  it('includes the experimental OpenAI Flex processing toggle', () => {
    expect(advancedSettingsItems).toContainEqual(
      expect.objectContaining({
        id: 'adv.openAIFlex',
        type: 'check',
        bindKey: 'openAIFlexProcessing',
        labelKey: 'openAIFlexProcessing',
        helpKey: 'openAIFlexProcessing',
        showExperimental: true,
      }),
    )
  })

  it('includes the legacy global lorebook and regex menu visibility toggle', () => {
    expect(advancedSettingsItems).toContainEqual(
      expect.objectContaining({
        id: 'adv.showGlobalLorebookAndRegex',
        type: 'check',
        bindKey: 'showGlobalLorebookAndRegex',
        labelKey: 'showGlobalLorebookAndRegex',
        helpKey: 'showGlobalLorebookAndRegex',
      }),
    )
  })

  it('does not advertise unsupported browser-side cold storage', () => {
    expect(advancedSettingsItems.some((item) => item.bindKey === 'coldstorage')).toBe(false)
  })

  it('does not advertise the retired browser remote-save encoder', () => {
    expect(advancedSettingsItems.some((item) => item.bindKey === 'enableRemoteSaving')).toBe(false)
  })

  it('does not advertise the legacy preset chain in server-backed generation', () => {
    expect(advancedSettingsItems.some((item) => item.bindKey === 'presetChain')).toBe(false)
  })

  it('does not advertise the removed Realm preview direct-open behavior', () => {
    expect(advancedSettingsItems.some((item) => item.bindKey === 'realmDirectOpen')).toBe(false)
  })
})
