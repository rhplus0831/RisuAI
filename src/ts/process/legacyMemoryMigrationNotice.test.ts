import { beforeEach, describe, expect, it, vi } from 'vitest'

const noticeState = vi.hoisted(() => ({
  database: {} as Record<string, unknown>,
  settingsResourceState: {
    value: {} as Record<string, unknown>,
    groupStatuses: { memory: 'ready' } as Record<string, string>,
    status: 'ready',
  },
  collectionsResourceState: {
    values: { hypaV3Presets: [] as unknown[] },
    statuses: { hypaV3Presets: 'ready' } as Record<string, string>,
    status: 'ready',
  },
  alertSelect: vi.fn(),
  persistSettings: vi.fn(async () => 'accepted'),
}))

vi.mock('../server/resourceState.svelte', () => ({
  settingsResourceState: noticeState.settingsResourceState,
  collectionsResourceState: noticeState.collectionsResourceState,
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => noticeState.database,
}))

vi.mock('../server/settingsOwner.svelte', () => ({
  persistServerBackedSettingsPatch: noticeState.persistSettings,
}))

vi.mock('../alert', () => ({
  alertSelect: noticeState.alertSelect,
}))

import {
  detectActiveRetiredMemoryAlgorithms,
  showLegacyMemoryMigrationNoticeIfNeeded,
} from './legacyMemoryMigrationNotice'

function installReadyOwner(database: Record<string, unknown>): void {
  noticeState.database = database
  const { hypaV3Presets = [], ...settings } = database
  noticeState.settingsResourceState.value = settings
  noticeState.collectionsResourceState.values.hypaV3Presets = hypaV3Presets as unknown[]
}

beforeEach(() => {
  installReadyOwner({})
  noticeState.settingsResourceState.groupStatuses.memory = 'ready'
  noticeState.settingsResourceState.status = 'ready'
  noticeState.collectionsResourceState.statuses.hypaV3Presets = 'ready'
  noticeState.collectionsResourceState.status = 'ready'
  noticeState.alertSelect.mockReset()
  noticeState.persistSettings.mockClear()
})

describe('legacy memory migration notice', () => {
  it('names each active retired memory selection without flagging maintained Hypa V3', () => {
    expect(
      detectActiveRetiredMemoryAlgorithms({
        memoryAlgorithmType: 'supaMemory',
        supaModelType: 'distilbart',
        hypaMemory: true,
      }),
    ).toEqual(['SupaMemory', 'Legacy HypaMemory'])
    expect(
      detectActiveRetiredMemoryAlgorithms({
        memoryAlgorithmType: 'hypaMemoryV2',
        hypav2: true,
        supaModelType: 'distilbart',
      }),
    ).toEqual(['Hypa V2'])
    expect(detectActiveRetiredMemoryAlgorithms({ memoryAlgorithmType: 'hanuraiMemory' })).toEqual(['Hanurai'])
    expect(
      detectActiveRetiredMemoryAlgorithms({
        hypaV3: true,
        selectedHypaV3PresetId: 'experimental',
        hypaV3PresetId: 0,
        hypaV3Presets: [
          { id: 'experimental', name: 'Legacy experimental', settings: { useExperimentalImpl: true } as any },
        ],
      }),
    ).toEqual(['Experimental Hypa V3'])
    expect(
      detectActiveRetiredMemoryAlgorithms({
        hypaV3: true,
        selectedHypaV3PresetId: 'maintained',
        hypaV3PresetId: 0,
        hypaV3Presets: [{ id: 'maintained', name: 'Maintained', settings: { useExperimentalImpl: false } as any }],
      }),
    ).toEqual([])
    expect(
      detectActiveRetiredMemoryAlgorithms({
        hypaV3: true,
        selectedHypaV3PresetId: 'missing',
        hypaV3PresetId: 99,
        hypaV3Presets: [{ id: 'maintained', name: 'Maintained', settings: { useExperimentalImpl: false } as any }],
        hypaV3Settings: { useExperimentalImpl: true } as any,
      }),
    ).toEqual([])
  })

  it('queues one non-blocking notice per database and persists dismissal only after it closes', async () => {
    let dismiss!: (value: string | null) => void
    noticeState.alertSelect.mockReturnValue(
      new Promise<string | null>((resolve) => {
        dismiss = resolve
      }),
    )
    installReadyOwner({
      memoryAlgorithmType: 'supaMemory',
      supaModelType: 'distilbart',
      hypaMemory: true,
    })

    expect(showLegacyMemoryMigrationNoticeIfNeeded()).toBe(true)
    expect(showLegacyMemoryMigrationNoticeIfNeeded()).toBe(false)
    expect(noticeState.alertSelect).toHaveBeenCalledOnce()
    expect(noticeState.alertSelect.mock.calls[0][1]).toContain('SupaMemory, Legacy HypaMemory')
    expect(noticeState.alertSelect.mock.calls[0][1]).toContain('Hypa V3')
    expect(noticeState.persistSettings).not.toHaveBeenCalled()

    dismiss(null)
    await vi.waitFor(() => {
      expect(noticeState.persistSettings).toHaveBeenCalledWith({ legacyMemoryMigrationNoticeDismissed: true })
    })
  })

  it('does not surface a notice after this database has dismissed it', () => {
    installReadyOwner({
      memoryAlgorithmType: 'hypaMemoryV2',
      legacyMemoryMigrationNoticeDismissed: true,
    })

    expect(showLegacyMemoryMigrationNoticeIfNeeded()).toBe(false)
    expect(noticeState.alertSelect).not.toHaveBeenCalled()
  })

  it('waits while both owners are loading', () => {
    noticeState.database = {
      memoryAlgorithmType: 'hypaMemoryV2',
      hypav2: true,
      hypaV3Presets: [],
    }
    noticeState.settingsResourceState.groupStatuses.memory = 'loading'
    noticeState.collectionsResourceState.statuses.hypaV3Presets = 'loading'
    noticeState.alertSelect.mockResolvedValue(null)

    expect(showLegacyMemoryMigrationNoticeIfNeeded()).toBe(false)
    expect(noticeState.alertSelect).not.toHaveBeenCalled()
  })

  it('fails closed instead of reusing aggregate memory data after an owner error', () => {
    noticeState.database = {
      memoryAlgorithmType: 'hypaMemoryV2',
      hypav2: true,
      hypaV3Presets: [],
    }
    noticeState.settingsResourceState.groupStatuses.memory = 'error'

    expect(showLegacyMemoryMigrationNoticeIfNeeded()).toBe(false)
    expect(noticeState.alertSelect).not.toHaveBeenCalled()
  })
})
