import { beforeEach, describe, expect, it, vi } from 'vitest'

const serverBackupState = vi.hoisted(() => ({
  createServerBackup: vi.fn(async () => ({ status: 'ok' as const, backup: { id: 'backup-a' } })),
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
}))

import { SaveServerBackup } from './backup'

beforeEach(() => {
  serverBackupState.createServerBackup.mockClear()
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
})
