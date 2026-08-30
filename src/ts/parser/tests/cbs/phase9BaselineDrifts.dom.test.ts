import { writable } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  PHASE9_BASELINE_DRIFT_FIXTURES,
  PHASE9_OVER_BUDGET_EACH_COUNT,
  phase9DriftCharacter,
  phase9DriftChat,
  phase9DriftDatabase,
  phase9DriftGroup,
  phase9OverBudgetEachInput,
} from '../../../../../test/fixtures/phase9BaselineDriftFixtures'

const state = vi.hoisted(() => ({ database: {} as any }))

vi.mock(import('../../../storage/database.svelte'), () => ({
  appVer: '1234.5.67',
  getCurrentCharacter: () => state.database.characters?.[0],
  getDatabase: () => state.database,
  reapplyPendingPresetProjections: () => {},
}))

vi.mock(import('../../../globalApi.svelte'), () => ({
  aiWatermarkingLawApplies: () => false,
  getFileSrc: () => Promise.resolve(''),
}))

vi.mock(import('../../../stores.svelte'), () => ({
  selIdState: { selId: 0 },
  selectedCharID: writable(0),
}))

import { risuChatParser } from '../../parser.svelte'
import { RisuParserBudgetError } from '../../risuChatParser'

const fixtures = PHASE9_BASELINE_DRIFT_FIXTURES

beforeEach(() => {
  state.database = phase9DriftDatabase([phase9DriftCharacter()])
})

describe('Phase 9 baseline-drift decisions — current browser parser', () => {
  it('keeps the RH+-authorized group retirement observable', () => {
    const group = phase9DriftGroup()
    state.database = phase9DriftDatabase([group, phase9DriftCharacter()])

    expect(risuChatParser(fixtures.groupCharacter.input, { chara: group as never })).toBe(
      fixtures.groupCharacter.currentExpected,
    )
  })

  it('keeps the RH+-authorized history window and reverse semantics', () => {
    state.database = phase9DriftDatabase([
      phase9DriftCharacter('Member', 'member') as ReturnType<typeof phase9DriftCharacter> & {
        chats: ReturnType<typeof phase9DriftChat>[]
      },
    ])
    state.database.characters[0].chats = [phase9DriftChat(fixtures.historyWindow.messages)]

    expect(JSON.parse(risuChatParser(fixtures.historyWindow.input))).toEqual(fixtures.historyWindow.currentExpected)
    expect(risuChatParser(fixtures.reverse.input)).toBe(fixtures.reverse.currentExpected)
  })

  it('preserves malformed missing-fmIndex tags like the baseline', () => {
    expect(risuChatParser(fixtures.missingFirstMessageIndex.input)).toBe(fixtures.missingFirstMessageIndex.expected)
  })

  it('keeps the RH+-authorized Fastify metadata and standalone slot semantics', () => {
    expect(risuChatParser(fixtures.metadata.input)).toBe(fixtures.metadata.currentExpected)
    expect(risuChatParser(fixtures.standaloneSlot.input, { var: { phase9: 'slot-value' } })).toBe(
      fixtures.standaloneSlot.currentExpected,
    )
  })

  it('keeps the RH+-authorized #each element cap visible', () => {
    expect(() => risuChatParser(phase9OverBudgetEachInput())).toThrow(RisuParserBudgetError)
    expect(() => risuChatParser(phase9OverBudgetEachInput())).toThrow(
      `{{#each}} element budget exceeded: ${PHASE9_OVER_BUDGET_EACH_COUNT} > 4096`,
    )
  })
})
