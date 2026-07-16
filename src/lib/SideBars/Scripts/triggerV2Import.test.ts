import { describe, expect, it } from 'vitest'

import { parseTriggerV2Import } from './triggerV2Import'

describe('Trigger V2 imports', () => {
  it('accepts trigger arrays with the required row structure', () => {
    expect(
      parseTriggerV2Import(JSON.stringify([{ comment: 'Imported', type: 'manual', conditions: [], effect: [] }])),
    ).toEqual([{ comment: 'Imported', type: 'manual', conditions: [], effect: [] }])
  })

  it.each([
    '{}',
    '[null]',
    '[{"comment":"Missing fields"}]',
    '[{"comment":"Bad conditions","type":"manual","conditions":{},"effect":[]}]',
  ])('rejects invalid trigger data: %s', (input) => {
    expect(parseTriggerV2Import(input)).toBeNull()
  })

  it('surfaces malformed JSON to the caller', () => {
    expect(() => parseTriggerV2Import('{')).toThrow()
  })
})
