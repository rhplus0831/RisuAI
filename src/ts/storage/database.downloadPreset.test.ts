import { beforeEach, describe, expect, it, vi } from 'vitest'

const exportApi = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  downloadFile: vi.fn(),
  ensureHydrated: vi.fn(async () => true),
}))

vi.mock('../server/promptTemplateHydration', () => ({
  ensurePromptTemplateHydrated: exportApi.ensureHydrated,
}))

vi.mock('../alert', async (importActual) => {
  const actual = await importActual<typeof import('../alert')>()
  return {
    ...actual,
    alertError: exportApi.alertError,
    alertNormal: exportApi.alertNormal,
  }
})

vi.mock('../globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('../globalApi.svelte')>()
  return { ...actual, downloadFile: exportApi.downloadFile }
})

vi.mock('../process/modules', async (importActual) => {
  const actual = await importActual<typeof import('../process/modules')>()
  return { ...actual, getModuleTriggers: () => [], moduleUpdate: () => {} }
})

import { downloadPreset } from './database.svelte'
import { replaceResourceDatabase } from '../server/resourceState.svelte'
function promptItem(id: string, text: string): Record<string, unknown> {
  return { id, type: 'plain', type2: 'normal', role: 'system', text }
}

beforeEach(() => {
  vi.clearAllMocks()
  exportApi.ensureHydrated.mockResolvedValue(true)
  replaceResourceDatabase({
    characters: [],
    promptPresetsId: 0,
    promptPresets: [
      { id: 'preset-a', name: 'Preset A' },
      { id: 'preset-b', name: 'Preset B', promptTemplate: [promptItem('b', 'body b')] },
    ],
  } as never)
})

describe('prompt preset export hydration', () => {
  it('re-resolves the preset by stable id after hydration reorders the collection', async () => {
    exportApi.ensureHydrated.mockImplementationOnce(async () => {
      replaceResourceDatabase({
        characters: [],
        promptPresetsId: 1,
        promptPresets: [
          { id: 'preset-b', name: 'Preset B', promptTemplate: [promptItem('b', 'body b')] },
          { id: 'preset-a', name: 'Preset A', promptTemplate: [promptItem('a', 'body a')] },
        ],
      } as never)
      return true
    })

    await downloadPreset(0, 'json')

    expect(exportApi.ensureHydrated).toHaveBeenCalledWith({
      applyProjection: false,
      promptPresetId: 'preset-a',
    })
    expect(exportApi.downloadFile).toHaveBeenCalledOnce()
    const [filename, body] = exportApi.downloadFile.mock.calls[0] as [string, Uint8Array]
    expect(filename).toBe('Preset A_preset.json')
    expect(JSON.parse(Buffer.from(body).toString('utf8'))).toMatchObject({
      id: 'preset-a',
      name: 'Preset A',
      promptTemplate: [promptItem('a', 'body a')],
    })
  })

  it('alerts and does not serialize when the owner disappears during hydration', async () => {
    exportApi.ensureHydrated.mockImplementationOnce(async () => {
      replaceResourceDatabase({
        characters: [],
        promptPresetsId: 0,
        promptPresets: [{ id: 'preset-b', name: 'Preset B' }],
      } as never)
      return true
    })

    await downloadPreset(0, 'json')

    expect(exportApi.alertError).toHaveBeenCalledOnce()
    expect(exportApi.downloadFile).not.toHaveBeenCalled()
  })
})
