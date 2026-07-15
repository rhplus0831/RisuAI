import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  downloadFile: vi.fn(),
  ensureAllCharacterLorebooksHydrated: vi.fn(),
  ensureAllChatsHydrated: vi.fn(),
  getDatabase: vi.fn(),
}))

vi.mock('./database.svelte', () => ({ getDatabase: mocks.getDatabase }))
vi.mock('../globalApi.svelte', () => ({ downloadFile: mocks.downloadFile }))
vi.mock('../alert', () => ({ alertError: mocks.alertError, alertNormal: mocks.alertNormal }))
vi.mock('../server/chatMessageHydration.svelte', () => ({
  ensureAllCharacterLorebooksHydrated: mocks.ensureAllCharacterLorebooksHydrated,
  ensureAllChatsHydrated: mocks.ensureAllChatsHydrated,
}))

import { exportAsDataset } from './exportAsDataset'

describe('exportAsDataset', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureAllChatsHydrated.mockResolvedValue(undefined)
    mocks.ensureAllCharacterLorebooksHydrated.mockResolvedValue(undefined)
    mocks.downloadFile.mockResolvedValue(undefined)
    mocks.getDatabase.mockReturnValue({
      characters: [
        {
          name: 'Character',
          desc: 'Description',
          globalLore: [{ key: 'Lore' }],
          chats: [{ message: [{ role: 'char', data: 'Hello' }] }],
        },
      ],
    })
  })

  it('reports hydration failures instead of leaving an unhandled rejection', async () => {
    const error = new Error('Unable to load all chats')
    mocks.ensureAllChatsHydrated.mockRejectedValue(error)

    await expect(exportAsDataset()).resolves.toBe(false)

    expect(mocks.alertError).toHaveBeenCalledWith(error)
    expect(mocks.downloadFile).not.toHaveBeenCalled()
    expect(mocks.alertNormal).not.toHaveBeenCalled()
  })

  it('reports download failures instead of showing a success alert', async () => {
    const error = new Error('Download failed')
    mocks.downloadFile.mockRejectedValue(error)

    await expect(exportAsDataset()).resolves.toBe(false)

    expect(mocks.alertError).toHaveBeenCalledWith(error)
    expect(mocks.alertNormal).not.toHaveBeenCalled()
  })

  it('downloads the fully hydrated dataset before reporting success', async () => {
    await expect(exportAsDataset()).resolves.toBe(true)

    expect(mocks.ensureAllChatsHydrated).toHaveBeenCalledWith({ strict: true })
    expect(mocks.ensureAllCharacterLorebooksHydrated).toHaveBeenCalledWith({ strict: true })
    expect(mocks.downloadFile).toHaveBeenCalledOnce()
    const [filename, contents] = mocks.downloadFile.mock.calls[0]
    expect(filename).toBe('dataset.json')
    expect(JSON.parse(contents.toString('utf-8'))).toEqual([
      {
        name: 'Character',
        description: 'Description',
        chats: [{ role: 'char', data: 'Hello' }],
        lorebook: [{ key: 'Lore' }],
      },
    ])
    expect(mocks.alertNormal).toHaveBeenCalledOnce()
    expect(mocks.alertError).not.toHaveBeenCalled()
  })
})
