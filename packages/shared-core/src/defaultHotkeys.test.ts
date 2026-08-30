import { describe, expect, it } from 'vitest'
import { defaultHotkeys, RETIRED_HOTKEY_ACTIONS } from './defaultHotkeys.js'

describe('default hotkey vocabulary', () => {
  it('keeps the default action order and key chords stable', () => {
    expect(defaultHotkeys).toHaveLength(22)
    expect(defaultHotkeys.map((hotkey) => hotkey.action)).toEqual([
      'reroll',
      'unreroll',
      'translate',
      'remove',
      'edit',
      'copy',
      'send',
      'settings',
      'home',
      'presets',
      'persona',
      'toggleCSS',
      'prevChar',
      'nextChar',
      'quickMenu',
      'quickSettings',
      'toggleLog',
      'previewRequest',
      'focusInput',
      'scrollToActiveChar',
      'popupEditor',
      'loadout',
    ])
    expect(defaultHotkeys.find((hotkey) => hotkey.action === 'send')).toEqual({
      key: 'Enter',
      ctrl: true,
      alt: true,
      action: 'send',
    })
    expect(defaultHotkeys.find((hotkey) => hotkey.action === 'focusInput')).toEqual({
      key: ' ',
      action: 'focusInput',
    })
  })

  it('keeps retired actions out of the default set', () => {
    expect([...RETIRED_HOTKEY_ACTIONS]).toEqual(['modelSelect', 'toggleVoice', 'webcam'])
    expect(defaultHotkeys.some((hotkey) => RETIRED_HOTKEY_ACTIONS.has(hotkey.action))).toBe(false)
  })
})
