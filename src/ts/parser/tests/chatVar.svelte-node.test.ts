import fc from 'fast-check'
import { writable } from 'svelte/store'
import { beforeEach, expect, test, vi } from 'vitest'
import { getChatVar, getGlobalChatVar, setChatVar } from '../chatVar.svelte'

//#region module mocks

const chatVarMocks = vi.hoisted(() => ({
  database: {
    characters: [
      {
        chatPage: 0,
        chats: [
          {
            scriptstate: {},
          },
        ],
        defaultVariables: '',
      },
    ],
    globalChatVariables: {} as Record<string, string>,
    templateDefaultVariables: '',
  },
}))

vi.mock(
  import('../../storage/database.svelte'),
  () =>
    ({
      appVer: '1234.5.67',
      getCurrentCharacter: () => ({}),
      getDatabase: () => chatVarMocks.database,
      reapplyPendingPresetProjections: () => {},
    }) as typeof import('../../storage/database.svelte'),
)

vi.mock(import('../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
}))

vi.mock(import('../../stores.svelte'), () => {
  return {
    selIdState: {
      selId: 0,
    },
    selectedCharID: writable(0),
  } as typeof import('../../stores.svelte')
})

//#endregion

const anyValidDefaultVarKey = fc.string({ minLength: 1, unit: 'grapheme' }).filter((s) => !/[=\n]/.test(s))
const anyValidDefaultVarValue = fc
  .anything()
  .map(JSON.stringify)
  .filter((s) => s !== undefined && !/[=\n]/.test(s))

beforeEach(() => {
  vi.resetAllMocks()
  chatVarMocks.database.characters[0].chats[0].scriptstate = {}
  chatVarMocks.database.characters[0].defaultVariables = ''
  chatVarMocks.database.globalChatVariables = {}
  chatVarMocks.database.templateDefaultVariables = ''
})

test('can get a character default variable', () => {
  fc.assert(
    fc.property(anyValidDefaultVarKey, anyValidDefaultVarValue, (key, value) => {
      chatVarMocks.database.characters[0].defaultVariables = `${key}=${value}`
      expect(getChatVar(key)).toBe(value)
    }),
  )
})

test('can get a template default variable', () => {
  fc.assert(
    fc.property(anyValidDefaultVarKey, anyValidDefaultVarValue, (key, value) => {
      chatVarMocks.database.templateDefaultVariables = `${key}=${value}`
      expect(getChatVar(key)).toBe(value)
    }),
  )
})

test('can set and get a chat variable', () => {
  fc.assert(
    fc.property(
      fc.string({ unit: 'grapheme' }),
      fc
        .anything()
        .filter((v) => v !== undefined)
        .map(JSON.stringify),
      (key, value) => {
        setChatVar(key, value)
        expect(getChatVar(key)).toBe(value)
      },
    ),
  )
})

test('can set a chat variable over its default value', () => {
  chatVarMocks.database.characters[0].defaultVariables = 'char=default'
  chatVarMocks.database.templateDefaultVariables = 'template=default'

  setChatVar('char', 'overridden')
  setChatVar('template', 'overridden')

  expect(getChatVar('char')).toBe('overridden')
  expect(getChatVar('template')).toBe('overridden')
})

test('reports whether a chat variable write changed stored state', () => {
  expect(setChatVar('status', 'ready')).toBe(true)
  expect(setChatVar('status', 'ready')).toBe(false)
  expect(getChatVar('status')).toBe('ready')
})

test('can get a global chat variable', () => {
  fc.assert(
    fc.property(
      fc.string({ unit: 'grapheme' }),
      fc
        .anything()
        .filter((v) => v !== undefined)
        .map(JSON.stringify),
      (key, value) => {
        chatVarMocks.database.globalChatVariables[`toggle_${key}`] = value

        expect(getGlobalChatVar(`toggle_${key}`)).toBe(value)
      },
    ),
  )
})

test('returns "null" for undefined variables', () => {
  fc.assert(
    fc.property(fc.string({ unit: 'grapheme' }), (key) => {
      expect(getChatVar(key)).toBe('null')
      expect(getGlobalChatVar(`toggle_${key}`)).toBe('null')
    }),
  )
})
