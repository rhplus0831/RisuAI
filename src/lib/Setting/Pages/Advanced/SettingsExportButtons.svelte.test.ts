import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exportMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertMd: vi.fn(),
  alertNormal: vi.fn(),
  downloadFile: vi.fn(async () => undefined),
  getRequestLog: vi.fn(() => ''),
}))

vi.mock('src/ts/alert', () => ({
  alertError: exportMocks.alertError,
  alertMd: exportMocks.alertMd,
  alertNormal: exportMocks.alertNormal,
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  downloadFile: exportMocks.downloadFile,
  getRequestLog: exportMocks.getRequestLog,
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => ({
    statics: {},
    safeSetting: 'included',
    apiKey: 'removed',
  }),
}))

import { language } from 'src/lang'
import SettingsExportButtons from './SettingsExportButtons.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

function bugReportButton(): HTMLButtonElement {
  const button = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find((candidate) =>
    candidate.textContent?.includes('Export Settings for Bug Report'),
  )
  if (!button) throw new Error('Bug-report export button not found')
  return button
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  exportMocks.downloadFile.mockResolvedValue(undefined)
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('SettingsExportButtons bug-report export', () => {
  it('reports a successful download when clipboard access is denied', async () => {
    const writeText = vi.fn(async () => {
      throw new Error('clipboard permission denied')
    })
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    component = mount(SettingsExportButtons, { target })

    bugReportButton().click()

    await vi.waitFor(() => {
      expect(exportMocks.alertNormal).toHaveBeenCalledWith(language.settingsExportedWithoutClipboard)
    })
    expect(exportMocks.downloadFile).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledOnce()
    expect(exportMocks.alertError).not.toHaveBeenCalled()
  })

  it('ignores repeat clicks while a report download is pending', async () => {
    const download = deferred<void>()
    exportMocks.downloadFile.mockReturnValueOnce(download.promise)
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    component = mount(SettingsExportButtons, { target })

    const button = bugReportButton()
    button.click()
    button.click()
    await tick()

    expect(exportMocks.downloadFile).toHaveBeenCalledOnce()
    expect(button.disabled).toBe(true)

    download.resolve()
    await vi.waitFor(() => expect(exportMocks.alertNormal).toHaveBeenCalledWith(language.settingsExported))
    expect(writeText).toHaveBeenCalledOnce()
    expect(button.disabled).toBe(false)
  })

  it('reports a failed download without attempting a clipboard copy', async () => {
    const downloadError = new Error('report download failed')
    exportMocks.downloadFile.mockRejectedValueOnce(downloadError)
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    component = mount(SettingsExportButtons, { target })

    bugReportButton().click()

    await vi.waitFor(() => expect(exportMocks.alertError).toHaveBeenCalledWith(downloadError))
    expect(writeText).not.toHaveBeenCalled()
    expect(exportMocks.alertNormal).not.toHaveBeenCalled()
    expect(bugReportButton().disabled).toBe(false)
  })
})
