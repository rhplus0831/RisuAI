import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const exportMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  alertMd: vi.fn(),
  alertNormal: vi.fn(),
  database: {} as Record<string, unknown>,
  downloadFile: vi.fn(async (_name: string, _data: Uint8Array) => undefined),
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
  getDatabase: () => exportMocks.database,
}))

import { language } from 'src/lang'
import { MASKED_PROVIDER_SECRET } from 'src/ts/providerSecretMask'
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
  exportMocks.database = {
    statics: {},
    safeSetting: 'included',
    apiKey: 'removed',
  }
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
  it('does not expose the retired usage-statistics dialog', () => {
    component = mount(SettingsExportButtons, { target })

    expect(target.textContent).not.toContain('Show Statistics')
  })

  it('redacts optimistic top-level, nested, and row-owned provider secrets before download and clipboard copy', async () => {
    exportMocks.database = {
      statics: {},
      safeSetting: 'included',
      falToken: 'optimistic-fal-secret',
      openaiCompatImage: {
        key: 'optimistic-image-secret',
        model: 'image-model',
      },
      providerCredentials: [
        {
          id: 'credential-api',
          name: 'API',
          type: 'apiKey',
          apiKey: 'optimistic-api-secret',
        },
        {
          id: 'credential-vertex',
          name: 'Vertex',
          type: 'vertexServiceAccount',
          vertex: { clientEmail: 'vertex@example.com', privateKey: 'optimistic-vertex-secret' },
        },
      ],
      modelPresets: [
        {
          id: 'model-preset-a',
          modelProfiles: [
            {
              id: 'model-profile-a',
              providerOptions: {
                apiKey: 'optimistic-model-preset-api-secret',
                vertex: {
                  clientEmail: 'optimistic-model-preset-vertex@example.com',
                  privateKey: 'optimistic-model-preset-vertex-secret',
                },
              },
            },
          ],
        },
      ],
    }
    const writeText = vi.fn(async (_text: string) => undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    component = mount(SettingsExportButtons, { target })

    bugReportButton().click()

    await vi.waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    const [, bytes] = exportMocks.downloadFile.mock.calls[0]
    const downloadedJson = new TextDecoder().decode(bytes)
    const clipboardJson = writeText.mock.calls[0][0]
    const report = JSON.parse(downloadedJson)

    expect(clipboardJson).toBe(downloadedJson)
    expect(report).toMatchObject({
      safeSetting: 'included',
      falToken: MASKED_PROVIDER_SECRET,
      openaiCompatImage: {
        key: MASKED_PROVIDER_SECRET,
        model: 'image-model',
      },
      providerCredentials: [
        {
          apiKey: MASKED_PROVIDER_SECRET,
        },
        {
          vertex: { privateKey: MASKED_PROVIDER_SECRET },
        },
      ],
      modelPresets: [
        {
          modelProfiles: [
            {
              providerOptions: {
                apiKey: MASKED_PROVIDER_SECRET,
                vertex: {
                  clientEmail: MASKED_PROVIDER_SECRET,
                  privateKey: MASKED_PROVIDER_SECRET,
                },
              },
            },
          ],
        },
      ],
    })
    expect(downloadedJson).not.toContain('optimistic-')
    expect(exportMocks.database.falToken).toBe('optimistic-fal-secret')
  })

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
