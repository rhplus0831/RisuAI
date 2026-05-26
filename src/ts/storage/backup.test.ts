import { beforeEach, describe, expect, it, vi } from 'vitest'

const serverBackupState = vi.hoisted(() => ({
  createServerBackup: vi.fn(async () => ({ status: 'ok' as const, backup: { id: 'backup-a' } })),
}))
const alertState = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertWait: vi.fn(),
}))
const localStorageState = vi.hoisted(() => ({
  localWriterInit: vi.fn(async () => {
    throw new Error('local writer should not initialize')
  }),
  forageKeys: vi.fn(async () => {
    throw new Error('local forage should not be read')
  }),
}))

vi.mock('src/ts/platform', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/platform')>()
  return {
    ...actual,
    isFastifyServer: true,
  }
})

vi.mock('../alert', () => ({
  alertConfirm: vi.fn(async () => true),
  alertError: alertState.alertError,
  alertMd: vi.fn(),
  alertNormal: alertState.alertNormal,
  alertStore: { set: vi.fn() },
  alertWait: alertState.alertWait,
}))

vi.mock('../globalApi.svelte', () => ({
  LocalWriter: class {
    init = localStorageState.localWriterInit
  },
  forageStorage: {
    keys: localStorageState.forageKeys,
    getItem: vi.fn(),
    setItem: vi.fn(),
  },
  requiresFullEncoderReload: { state: false },
}))

vi.mock('../server/backups', () => ({
  createServerBackup: serverBackupState.createServerBackup,
}))

vi.mock('./database.svelte', () => ({
  appVer: 'test',
  getCurrentCharacter: vi.fn(() => null),
  getCurrentChat: vi.fn(() => null),
  getDatabase: vi.fn(() => ({ characters: [] })),
  setDatabaseLite: vi.fn(),
}))

vi.mock('./risuSave', () => ({
  decodeRisuSave: vi.fn(),
  encodeRisuSaveLegacy: vi.fn(),
}))

vi.mock('../process/coldstorage.svelte', () => ({
  getColdStorageItem: vi.fn(),
  listColdDataKeys: vi.fn(async () => []),
  setColdStorageItem: vi.fn(),
}))


vi.mock('src/lang', () => ({
  language: {
    partialBackupFirstConfirm: 'partial first',
    partialBackupSecondConfirm: 'partial second',
  },
}))

import { LoadLocalBackup, SaveLocalBackup, SavePartialLocalBackup } from './backup'

beforeEach(() => {
  serverBackupState.createServerBackup.mockClear()
  alertState.alertError.mockClear()
  alertState.alertNormal.mockClear()
  alertState.alertWait.mockClear()
  localStorageState.localWriterInit.mockClear()
  localStorageState.forageKeys.mockClear()
})

describe('Fastify backup storage gates', () => {
  it('routes manual backup creation through the server backup API', async () => {
    await SaveLocalBackup()

    expect(serverBackupState.createServerBackup).toHaveBeenCalledWith({ label: 'Manual backup' })
    expect(alertState.alertWait).toHaveBeenCalledWith('Saving server backup...')
    expect(alertState.alertNormal).toHaveBeenCalledWith('Server backup saved')
    expect(localStorageState.localWriterInit).not.toHaveBeenCalled()
    expect(localStorageState.forageKeys).not.toHaveBeenCalled()
  })

  it('blocks local partial backup and local file restore before local storage access', async () => {
    await SavePartialLocalBackup()
    LoadLocalBackup()

    expect(alertState.alertError).toHaveBeenCalledWith(
      'Partial local backup is not supported in server-backed web mode yet',
    )
    expect(alertState.alertError).toHaveBeenCalledWith(
      'Local backup file restore is not supported in server-backed web mode yet',
    )
    expect(localStorageState.localWriterInit).not.toHaveBeenCalled()
    expect(localStorageState.forageKeys).not.toHaveBeenCalled()
  })
})
