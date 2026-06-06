import { writable } from 'svelte/store'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { risuChatParser } from '../../parser.svelte'
import { RISU_EACH_EXPANSION_BUDGET, RisuParserBudgetError } from '../../risuChatParser'
import { resetChatVariables } from './lib'
import { setChatVar } from '../../chatVar.svelte'

//#region module mocks

vi.mock(
  import('../../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getDatabase: () => ({}),
    }) as typeof import('../../../storage/database.svelte'),
)

vi.mock(import('../../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
}))

vi.mock(import('../../../stores.svelte'), () => {
  return {
    DBState: {
      db: {
        characters: [{ chatPage: 0, chats: [{ scriptstate: {} }], defaultVariables: '' }],
        globalChatVariables: {},
        templateDefaultVariables: '',
      },
    },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as typeof import('../../../stores.svelte')
})

//#endregion

beforeEach(() => {
  vi.resetAllMocks()
  resetChatVariables()
})

// These lock the {{#each}} re-injection rewrite, which now drops the already
// consumed source prefix and resets the pointer instead of rebuilding the whole
// source. The risk is that surrounding text or sibling/nested blocks regress.
describe('#each re-injection (Phase 7 prefix-drop rewrite)', () => {
  test('preserves text before and after the block', () => {
    expect(risuChatParser('PRE {{#each [1, 2, 3] as n}}{{slot::n}}{{/}} POST')).toBe('PRE 123 POST')
  })

  test('two sequential blocks each keep their surrounding text', () => {
    expect(
      risuChatParser(
        'A{{#each::keep [1, 2] as n}}{{slot::n}}{{/}}B{{#each::keep [3, 4] as m}}{{slot::m}}{{/}}C',
      ),
    ).toBe('A12B34C')
  })

  test('nested blocks expand the inner template per outer element', () => {
    expect(
      risuChatParser(
        '{{#each::keep [1, 2] as x}}{{#each::keep [3, 4] as y}}{{slot::x}}{{slot::y}}\n{{/}}{{/}}',
      ),
    ).toBe('13\n14\n23\n24\n')
  })

  test('triple-nested blocks stay correct after repeated re-injection', () => {
    expect(
      risuChatParser(
        '{{#each::keep [1, 2] as x}}{{#each::keep [3, 4] as y}}{{#each::keep [5, 6] as z}}{{slot::x}}{{slot::y}}{{slot::z}} {{/}}{{/}}{{/}}',
      ),
      // all three levels are ::keep, so the innermost trailing space survives.
    ).toBe('135 136 145 146 235 236 245 246 ')
  })

  test('empty array drops the block but keeps surrounding text', () => {
    expect(risuChatParser('X{{#each [] as n}}{{slot::n}}{{/}}Y')).toBe('XY')
  })

  test('a large array expands without losing the trailing text', () => {
    const arr = Array.from({ length: 100 }, (_unused, i) => i)
    const out = risuChatParser(`{{#each::keep ${JSON.stringify(arr)} as n}}{{slot::n}},{{/}}END`)
    expect(out).toBe(arr.map((n) => `${n},`).join('') + 'END')
  })

  test('an each block fed from a chat variable expands its values', () => {
    setChatVar('arr', JSON.stringify(['a', 'b', 'c']))
    expect(risuChatParser('{{#each {{getvar::arr}} as n}}[{{slot::n}}]{{/}}')).toBe('[a][b][c]')
  })
})

describe('#each budget (Phase 3 L10)', () => {
  test('L10: keeps normal and nested #each output byte-identical below the cap', () => {
    expect(risuChatParser('A{{#each [1, 2] as n}}({{slot::n}}){{/}}Z')).toBe('A(1)(2)Z')
    expect(
      risuChatParser(
        '{{#each::keep [1, 2] as x}}{{#each::keep ["a", "b"] as y}}{{slot::x}}:{{slot::y}};{{/}}{{/}}',
      ),
    ).toBe('1:a;1:b;2:a;2:b;')
  })

  test('L10: throws parser budget error when #each element count exceeds cap', () => {
    const arr = Array.from(
      { length: RISU_EACH_EXPANSION_BUDGET.maxElements + 1 },
      (_unused, i) => i,
    )

    expect(() =>
      risuChatParser(`{{#each::keep ${JSON.stringify(arr)} as n}}{{slot::n}}{{/}}`),
    ).toThrow(RisuParserBudgetError)
  })

  test('L10: throws parser budget error when #each expanded output exceeds cap', () => {
    const body = 'x'.repeat(Math.floor(RISU_EACH_EXPANSION_BUDGET.maxExpandedChars / 2) + 1)

    expect(() => risuChatParser(`{{#each::keep [1, 2] as n}}${body}{{/}}`)).toThrow(
      /expanded output budget exceeded/,
    )
  })
})
