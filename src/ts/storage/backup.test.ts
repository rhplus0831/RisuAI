import { beforeEach, describe, expect, it, vi } from 'vitest'

const serverBackupState = vi.hoisted(() => ({
  createServerBackup: vi.fn(async () => ({ status: 'ok' as const, backup: { id: 'backup-a' } })),
  importServerBundle: vi.fn(),
}))
const alertState = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertNormal: vi.fn(),
  alertWait: vi.fn(),
}))
vi.mock('../alert', () => ({
  alertError: alertState.alertError,
  alertNormal: alertState.alertNormal,
  alertWait: alertState.alertWait,
}))

vi.mock('../server/backups', () => ({
  createServerBackup: serverBackupState.createServerBackup,
  importServerBundle: serverBackupState.importServerBundle,
}))

import { language } from '../../lang'
import { loadBackupFromDevice, SaveServerBackup } from './backup'

beforeEach(() => {
  serverBackupState.createServerBackup.mockClear()
  serverBackupState.importServerBundle.mockReset()
  alertState.alertError.mockClear()
  alertState.alertNormal.mockClear()
  alertState.alertWait.mockClear()
})

describe('Fastify backup storage gates', () => {
  it('routes manual backup creation through the server backup API', async () => {
    await SaveServerBackup()

    expect(serverBackupState.createServerBackup).toHaveBeenCalledWith({ label: 'Manual backup' })
    expect(alertState.alertWait).toHaveBeenCalledWith('Saving server backup...')
    expect(alertState.alertNormal).toHaveBeenCalledWith('Server backup saved')
  })

  it('shows one restore warning when database replacement discards queued changes', async () => {
    const file = new File(['backup'], 'database.risu.zip', { type: 'application/zip' })
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function () {
      Object.defineProperty(this, 'files', { configurable: true, value: [file] })
      this.onchange?.(new Event('change'))
    })
    serverBackupState.importServerBundle.mockResolvedValue({
      status: 'ok',
      revision: 2,
      discardedPendingMutations: 1,
    })

    await expect(loadBackupFromDevice()).resolves.toBe('ok')

    expect(alertState.alertError).toHaveBeenCalledOnce()
    expect(alertState.alertError).toHaveBeenCalledWith(language.backupQueuedChangesDiscarded)
    expect(alertState.alertNormal).not.toHaveBeenCalled()
  })
})
