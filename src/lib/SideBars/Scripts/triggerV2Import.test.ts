import { describe, expect, it } from 'vitest'

import { parseTriggerV2Import } from './triggerV2Import'
import { diagnoseServerTriggerCompatibility } from 'src/ts/process/triggerServerSupport'

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

  it.each([
    ['null condition', { conditions: [null] }],
    ['array condition', { conditions: [[]] }],
    ['condition missing type', { conditions: [{}] }],
    ['condition with non-string type', { conditions: [{ type: 1 }] }],
    ['null effect', { effect: [null] }],
    ['array effect', { effect: [[]] }],
    ['effect missing type', { effect: [{}] }],
    ['effect with non-string type', { effect: [{ type: false }] }],
    ['effect with non-number indent', { effect: [{ type: 'v2Future', indent: '0' }] }],
  ])('rejects a malformed nested %s', (_label, overrides) => {
    expect(
      parseTriggerV2Import(
        JSON.stringify([{ comment: 'Imported', type: 'manual', conditions: [], effect: [], ...overrides }]),
      ),
    ).toBeNull()
  })

  it('preserves forward-compatible nested types and fields', () => {
    const input = [
      {
        comment: 'Future trigger',
        type: 'future-mode',
        conditions: [{ type: 'future-condition', futureFlag: true }],
        effect: [{ type: 'v2FutureEffect', indent: 2, futurePayload: { enabled: true } }],
        futureTriggerField: 'preserved',
      },
    ]

    expect(parseTriggerV2Import(JSON.stringify(input))).toEqual(input)
  })

  it('surfaces malformed JSON to the caller', () => {
    expect(() => parseTriggerV2Import('{')).toThrow()
  })

  it('diagnoses unsupported definitions without changing imported data', () => {
    const imported = parseTriggerV2Import(
      JSON.stringify([
        {
          comment: 'Compatibility',
          type: 'start',
          conditions: [{ type: 'value', var: '{{screenheight}}', operator: '=', value: '1' }],
          effect: [{ type: 'v2SetPersonaDesc', value: 'unchanged', valueType: 'value', indent: 0 }],
        },
      ]),
    )
    const before = structuredClone(imported)

    expect(diagnoseServerTriggerCompatibility(imported)).toEqual({
      unsupportedEffectTypes: ['v2SetPersonaDesc'],
      unsupportedCbsCallbacks: [],
    })
    expect(imported).toEqual(before)
  })
})
