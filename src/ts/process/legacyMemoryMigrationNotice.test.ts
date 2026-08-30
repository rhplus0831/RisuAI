import { beforeEach, describe, expect, it, vi } from 'vitest'

const noticeState = vi.hoisted(() => ({
  database: {} as Record<string, unknown>,
  alertSelect: vi.fn(),
  persistSettings: vi.fn(async () => 'accepted'),
}))

vi.mock('../server/resourceState.svelte', () => ({
  getResourceDatabase: () => noticeState.database,
}))

vi.mock('../server/settingsBridge.svelte', () => ({
  persistServerBackedSettingsPatch: noticeState.persistSettings,
}))

vi.mock('../alert', () => ({
  alertSelect: noticeState.alertSelect,
}))

import {
  detectActiveRetiredMemoryAlgorithms,
  showLegacyMemoryMigrationNoticeIfNeeded,
} from './legacyMemoryMigrationNotice'

beforeEach(() => {
  noticeState.database = {}
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
        hypaV3PresetId: 0,
        hypaV3Presets: [{ name: 'Legacy experimental', settings: { useExperimentalImpl: true } as any }],
      }),
    ).toEqual(['Experimental Hypa V3'])
    expect(
      detectActiveRetiredMemoryAlgorithms({
        hypaV3: true,
        hypaV3PresetId: 0,
        hypaV3Presets: [{ name: 'Maintained', settings: { useExperimentalImpl: false } as any }],
      }),
    ).toEqual([])
    expect(
      detectActiveRetiredMemoryAlgorithms({
        hypaV3: true,
        hypaV3PresetId: 99,
        hypaV3Presets: [{ name: 'Maintained', settings: { useExperimentalImpl: false } as any }],
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
    noticeState.database = {
      memoryAlgorithmType: 'supaMemory',
      supaModelType: 'distilbart',
      hypaMemory: true,
    }

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
    noticeState.database = {
      memoryAlgorithmType: 'hypaMemoryV2',
      legacyMemoryMigrationNoticeDismissed: true,
    }

    expect(showLegacyMemoryMigrationNoticeIfNeeded()).toBe(false)
    expect(noticeState.alertSelect).not.toHaveBeenCalled()
  })
})
