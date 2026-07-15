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

import { autoServerBackup } from './backup'

beforeEach(() => {
  backupMocks.alertNormal.mockReset()
  backupMocks.alertSelect.mockReset()
  backupMocks.setDatabase.mockReset()
  backupMocks.database = { account: { kei: false, token: 'kei-token' } }
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
})
