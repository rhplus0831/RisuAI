import { describe, expect, it } from 'vitest'
import {
  SERVER_STANDALONE_SETTING_NAMES,
  isServerStandaloneSettingName,
  isServerStandaloneSettingPayload,
} from '@risuai/protocol/standalone-settings'

describe('standalone-settings protocol', () => {
  it('publishes and validates the exact nine-name taxonomy', () => {
    expect(SERVER_STANDALONE_SETTING_NAMES).toEqual([
      'selectedPersonaId',
      'selectedPersona',
      'botPresetsId',
      'modelPresetsId',
      'promptPresetsId',
      'loreBookPage',
      'personaPrompt',
      'userIcon',
      'userNote',
    ])
    for (const name of SERVER_STANDALONE_SETTING_NAMES) expect(isServerStandaloneSettingName(name)).toBe(true)
    expect(isServerStandaloneSettingName('database')).toBe(false)
  })

  it.each(SERVER_STANDALONE_SETTING_NAMES)('accepts the %s absent state', (setting) => {
    expect(isServerStandaloneSettingPayload({ revision: 0, setting, state: { present: false } })).toBe(true)
  })

  it.each([null, undefined, false, 0, '', [], {}, { nested: ['opaque'] }])(
    'accepts the unknown present value %j',
    (value) => {
      expect(
        isServerStandaloneSettingPayload({
          revision: Number.MAX_SAFE_INTEGER,
          setting: 'userNote',
          state: { present: true, value },
        }),
      ).toBe(true)
    },
  )

  it('keeps the outer payload additive', () => {
    expect(
      isServerStandaloneSettingPayload({
        revision: 7,
        setting: 'selectedPersona',
        state: { present: true, value: 'persona-1' },
        futureMetadata: true,
      }),
    ).toBe(true)
  })

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects the invalid revision %j',
    (revision) => {
      expect(isServerStandaloneSettingPayload({ revision, setting: 'userNote', state: { present: false } })).toBe(false)
    },
  )

  it.each([
    { present: false, value: 'unexpected' },
    { present: true },
    { present: true, value: 'note', extra: true },
    { present: 'true', value: 'note' },
  ])('rejects the malformed state %j', (state) => {
    expect(isServerStandaloneSettingPayload({ revision: 1, setting: 'userNote', state })).toBe(false)
  })
})
