import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const userSettingsMocks = vi.hoisted(() => ({
  alertConfirm: vi.fn(),
  exportAsDataset: vi.fn(),
  saveZipBackupToDevice: vi.fn(async () => 'ok' as const),
}))

vi.mock('src/ts/alert', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/alert')>()
  return {
    ...actual,
    alertConfirm: userSettingsMocks.alertConfirm,
  }
})

vi.mock('src/ts/storage/backup', () => ({
  SaveServerBackup: vi.fn(async () => 'ok'),
  loadBackupFromDevice: vi.fn(async () => 'ok'),
  saveBackupToDevice: vi.fn(async () => 'ok'),
  saveZipBackupToDevice: userSettingsMocks.saveZipBackupToDevice,
}))

vi.mock('src/ts/storage/exportAsDataset', () => ({
  exportAsDataset: userSettingsMocks.exportAsDataset,
}))

vi.mock('src/ts/globalApi.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/globalApi.svelte')>()
  return {
    ...actual,
    loadInternalBackup: vi.fn(),
  }
})

import { language } from 'src/lang'
import UserSettings from './UserSettings.svelte'

let target: HTMLElement
let component: ReturnType<typeof mount> | undefined

function button(label: string): HTMLButtonElement {
  const found = Array.from(target.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!found) throw new Error(`Button not found: ${label}`)
  return found
}

beforeEach(() => {
  vi.clearAllMocks()
  userSettingsMocks.alertConfirm.mockResolvedValue(false)
  target = document.createElement('div')
  document.body.appendChild(target)
  component = mount(UserSettings, { target })
})

afterEach(() => {
  if (component) unmount(component)
  component = undefined
  target.remove()
})

describe('portable backup warnings', () => {
  it('does not request the credential-bearing bundle when the user cancels the secrets warning', async () => {
    button(language.saveBackupLocalZipStyle).click()
    await tick()

    expect(userSettingsMocks.alertConfirm).toHaveBeenCalledWith(language.portableSaveSecretsWarning)
    expect(userSettingsMocks.saveZipBackupToDevice).not.toHaveBeenCalled()
  })

  it('continues the bundle export after the user accepts the secrets warning', async () => {
    userSettingsMocks.alertConfirm.mockResolvedValueOnce(true)

    button(language.saveBackupLocalZipStyle).click()

    await vi.waitFor(() => expect(userSettingsMocks.saveZipBackupToDevice).toHaveBeenCalledOnce())
    expect(userSettingsMocks.alertConfirm).toHaveBeenCalledWith(language.portableSaveSecretsWarning)
    expect(userSettingsMocks.saveZipBackupToDevice).toHaveBeenCalledWith({ onProgress: expect.any(Function) })
  })

  it('does not show the credential warning for the content-scoped dataset export', async () => {
    button(language.exportAsDataset).click()
    await tick()

    expect(userSettingsMocks.exportAsDataset).toHaveBeenCalledOnce()
    expect(userSettingsMocks.alertConfirm).not.toHaveBeenCalled()
  })
})
