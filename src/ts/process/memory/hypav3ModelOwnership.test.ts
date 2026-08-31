// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest'
import type { Database } from '../../storage/database.svelte'
import { getCurrentHypaV3Preset, resolveHypaV3ResponseTokenReservation, summarize } from './hypav3'
import { replaceResourceDatabase, settingsResourceState } from '../../server/resourceState.svelte'

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

  it('uses the canonical profile default instead of a flat compatibility budget', () => {
    expect(resolveHypaV3ResponseTokenReservation(database({ maxResponse: 640 }))).toBe(500)
  })

  it('resolves the current preset from stable identity instead of a conflicting numeric projection', () => {
    replaceResourceDatabase(
      database({
        hypaV3Presets: [
          { id: 'preset-a', name: 'Alpha', settings: {} },
          { id: 'preset-b', name: 'Beta', settings: {} },
        ],
        selectedHypaV3PresetId: 'preset-b',
        hypaV3PresetId: 1,
      } as Partial<Database>),
    )

    expect(getCurrentHypaV3Preset().name).toBe('Beta')
  })

  it.each([
    { label: 'missing stable selection', selectedHypaV3PresetId: undefined, hypaV3PresetId: 1 },
    { label: 'unknown stable selection', selectedHypaV3PresetId: 'missing', hypaV3PresetId: 1 },
    { label: 'conflicting numeric projection', selectedHypaV3PresetId: 'preset-b', hypaV3PresetId: 0 },
  ])('fails current-preset resolution closed for $label', ({ selectedHypaV3PresetId, hypaV3PresetId }) => {
    replaceResourceDatabase(
      database({
        hypaV3Presets: [
          { id: 'preset-a', name: 'Alpha', settings: {} },
          { id: 'preset-b', name: 'Beta', settings: {} },
        ],
        ...(selectedHypaV3PresetId === undefined ? {} : { selectedHypaV3PresetId }),
        hypaV3PresetId,
      } as Partial<Database>),
    )

    expect(() => getCurrentHypaV3Preset()).toThrow('Preset not found. Please select a valid preset.')
  })

  it('fails current-preset resolution closed for duplicate preset ids', () => {
    replaceResourceDatabase(
      database({
        hypaV3Presets: [
          { id: 'duplicate', name: 'Alpha', settings: {} },
          { id: 'duplicate', name: 'Beta', settings: {} },
        ],
        selectedHypaV3PresetId: 'duplicate',
        hypaV3PresetId: 0,
      } as Partial<Database>),
    )

    expect(() => getCurrentHypaV3Preset()).toThrow('Preset not found. Please select a valid preset.')
  })

  it.each(['idle', 'loading', 'error'] as const)(
    'does not summarize while the settings owner is %s',
    async (status) => {
      replaceResourceDatabase(database())
      settingsResourceState.status = status

      try {
        await expect(summarize([])).rejects.toThrow('HypaV3 settings owner unavailable')
      } finally {
        settingsResourceState.status = 'ready'
      }
    },
  )
})
