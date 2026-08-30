import { writable } from 'svelte/store'
import { beforeEach, expect, test, vi } from 'vitest'
import { PHASE9_CBS_COMPATIBILITY_CORPUS } from '../fixtures/phase9CompatibilityCorpus'
import {
  PHASE9_BASELINE_DRIFT_FIXTURES,
  PHASE9_OVER_BUDGET_EACH_COUNT,
  phase9DriftCharacter,
  phase9DriftChat,
  phase9DriftDatabase,
  phase9DriftGroup,
  phase9OverBudgetEachInput,
} from '../fixtures/phase9BaselineDriftFixtures'

const fixtureState = vi.hoisted(() => {
  const variables = new Proxy({} as Record<string, unknown>, {
    get(_target, property) {
      return typeof property === 'string' ? property.replace(/^\$+/, '') : undefined
    },
  })
  return {
    database: {} as any,
    variables,
  }
})

vi.mock('src/ts/storage/database.svelte.ts', () => ({
  appVer: '1234.5.67',
  getCurrentCharacter: () => fixtureState.database.characters[0],
  getDatabase: () => fixtureState.database,
}))

vi.mock('src/ts/globalApi.svelte.ts', () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
}))

vi.mock('src/ts/stores.svelte.ts', () => ({
  DBState: { db: fixtureState.database },
  selIdState: { selId: 0 },
  selectedCharID: writable(0),
}))

import { risuChatParser } from 'src/ts/parser/parser.svelte.ts'

beforeEach(() => {
  fixtureState.database = phase9DriftDatabase([phase9DriftCharacter()]) as any
})

test.each(PHASE9_CBS_COMPATIBILITY_CORPUS)(
  'baseline runs the shared Phase 9 CBS corpus: $name',
  ({ input, expected }) => {
    expect(risuChatParser(input)).toBe(expected)
  },
)

test('baseline resolves a group parser argument to the last speaking member', () => {
  const group = phase9DriftGroup()
  fixtureState.database = phase9DriftDatabase([group, phase9DriftCharacter()]) as any

  expect(risuChatParser(PHASE9_BASELINE_DRIFT_FIXTURES.groupCharacter.input, { chara: group as any })).toBe(
    PHASE9_BASELINE_DRIFT_FIXTURES.groupCharacter.baselineExpected,
  )
})

test('baseline treats every history argument as an all-message request', () => {
  const char = phase9DriftCharacter() as any
  char.chats = [phase9DriftChat(PHASE9_BASELINE_DRIFT_FIXTURES.historyWindow.messages)]
  fixtureState.database = phase9DriftDatabase([char]) as any

  expect(JSON.parse(risuChatParser(PHASE9_BASELINE_DRIFT_FIXTURES.historyWindow.input))).toEqual(
    PHASE9_BASELINE_DRIFT_FIXTURES.historyWindow.baselineExpected,
  )
})

test('baseline reverses the raw matcher text', () => {
  expect(risuChatParser(PHASE9_BASELINE_DRIFT_FIXTURES.reverse.input)).toBe(
    PHASE9_BASELINE_DRIFT_FIXTURES.reverse.baselineExpected,
  )
})

test('baseline preserves firstmsgindex when malformed chat data omits fmIndex', () => {
  fixtureState.database = phase9DriftDatabase([phase9DriftCharacter()]) as any

  expect(risuChatParser(PHASE9_BASELINE_DRIFT_FIXTURES.missingFirstMessageIndex.input)).toBe(
    PHASE9_BASELINE_DRIFT_FIXTURES.missingFirstMessageIndex.expected,
  )
})

test('baseline exposes its retired runtime metadata values', () => {
  fixtureState.database = phase9DriftDatabase([phase9DriftCharacter()]) as any

  expect(risuChatParser(PHASE9_BASELINE_DRIFT_FIXTURES.metadata.input)).toBe(
    PHASE9_BASELINE_DRIFT_FIXTURES.metadata.baselineExpected,
  )
})

test('baseline leaves a standalone slot tag literal', () => {
  expect(
    risuChatParser(PHASE9_BASELINE_DRIFT_FIXTURES.standaloneSlot.input, {
      var: { phase9: 'slot-value' },
    }),
  ).toBe(PHASE9_BASELINE_DRIFT_FIXTURES.standaloneSlot.baselineExpected)
})

test('baseline expands #each beyond the current element cap', () => {
  expect(risuChatParser(phase9OverBudgetEachInput())).toBe('1'.repeat(PHASE9_OVER_BUDGET_EACH_COUNT))
})
