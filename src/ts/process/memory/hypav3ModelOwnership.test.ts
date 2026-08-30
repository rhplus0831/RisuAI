// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import type { Database } from '../../storage/database.svelte'
import { resolveHypaV3ResponseTokenReservation } from './hypav3'

function database(overrides: Partial<Database> = {}): Database {
  return {
    aiModel: 'gpt-5',
    modelRoles: {},
    seperateModelsForAxModels: false,
    seperateModels: {},
    fallbackModels: {},
    customModels: [],
    modelTools: [],
    maxContext: 8192,
    maxResponse: 512,
    temperature: 50,
    frequencyPenalty: -1000,
    PresensePenalty: -1000,
    useStreaming: true,
    genTime: 1,
    extractJson: '',
    OaiCompAPIKeys: {},
    openrouterProvider: { order: [], only: [], ignore: [] },
    ...overrides,
  } as unknown as Database
}

describe('HypaV3 model ownership', () => {
  it('reserves the resolved chat profile response budget over a conflicting flat value', () => {
    const db = database({
      maxResponse: 777,
      modelProfiles: [
        {
          id: 'main-profile',
          name: 'Main profile',
          modelId: 'gpt-5',
          runtimeOptions: { maxResponse: 128 },
        },
      ],
      modelRoleProfiles: { chatMain: { mode: 'profile', profileId: 'main-profile' } },
    } as Partial<Database>)

    expect(resolveHypaV3ResponseTokenReservation(db)).toBe(128)
  })

  it('retains the flat response budget for an explicit legacy selection', () => {
    expect(resolveHypaV3ResponseTokenReservation(database({ maxResponse: 640 }))).toBe(640)
  })
})
