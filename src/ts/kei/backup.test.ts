import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backupMocks = vi.hoisted(() => ({
  alertNormal: vi.fn(),
  alertSelect: vi.fn(),
  database: { account: { kei: false, token: 'kei-token' } } as Record<string, any>,
  setDatabase: vi.fn(),
}))

vi.mock('../alert', () => ({
  alertNormal: backupMocks.alertNormal,
  alertSelect: backupMocks.alertSelect,
}))

vi.mock('./kei', () => ({
  keiServerURL: () => 'https://kei.example',
}))

vi.mock('../storage/database.svelte', () => ({
  getDatabase: () => backupMocks.database,
  setDatabase: backupMocks.setDatabase,
}))

vi.mock('../globalApi.svelte', () => ({
  requiresFullEncoderReload: { state: false },
}))

import { autoServerBackup, resetKeiBackupStateForTests, saveDbKei } from './backup'

beforeEach(() => {
  backupMocks.alertNormal.mockReset()
  backupMocks.alertSelect.mockReset()
  backupMocks.setDatabase.mockReset()
  backupMocks.database = { account: { kei: false, token: 'kei-token' } }
  resetKeiBackupStateForTests()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Risu-Kei backups', () => {
  it('shows the resolved server error body instead of a Promise string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('backup service failed', { status: 500 })),
    )

    await autoServerBackup()

    expect(backupMocks.alertNormal).toHaveBeenCalledWith('Error: backup service failed')
  })

  it('wraps Previous to the final non-empty page for exact page-size multiples', async () => {
    const backups = Array.from({ length: 10 }, (_, index) => [`backup-${index}`, `id-${index}`])
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ activated: false, backups })),
    )
    backupMocks.alertSelect.mockImplementation(async (menu: string[]) => {
      const call = backupMocks.alertSelect.mock.calls.length
      return String(menu.indexOf(call === 1 ? 'Previous' : 'Cancel'))
    })

    await autoServerBackup()

    expect(backupMocks.alertSelect).toHaveBeenCalledTimes(2)
    expect(backupMocks.alertSelect.mock.calls[1][0].slice(0, 5)).toEqual([
      'backup-5',
      'backup-6',
      'backup-7',
      'backup-8',
      'backup-9',
    ])
  })

  it('allows an automatic save to retry after a failed request', async () => {
    backupMocks.database = { account: { kei: true, token: 'kei-token' }, value: 'database' }
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await saveDbKei()
    await saveDbKei()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('coalesces concurrent automatic saves and throttles only after success', async () => {
    backupMocks.database = { account: { kei: true, token: 'kei-token' }, value: 'database' }
    let resolveSave!: (response: Response) => void
    const pendingSave = new Promise<Response>((resolve) => {
      resolveSave = resolve
    })
    const fetchMock = vi.fn(() => pendingSave)
    vi.stubGlobal('fetch', fetchMock)

    const first = saveDbKei()
    const second = saveDbKei()
    expect(fetchMock).toHaveBeenCalledOnce()
    resolveSave(new Response(null, { status: 204 }))
    await Promise.all([first, second])
    await saveDbKei()

    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
