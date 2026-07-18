import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backgroundMocks = vi.hoisted(() => ({
  alertError: vi.fn(),
  applyServerBackedSetting: vi.fn(),
  saveImage: vi.fn(),
  selectSingleFile: vi.fn(),
}))

vi.mock('src/ts/process/modules', () => ({
  getModuleAssets: vi.fn(() => []),
  getModuleLorebooks: vi.fn(() => []),
  getModuleRegexScripts: vi.fn(() => []),
  getModules: vi.fn(() => []),
  moduleUpdate: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/storage/database.svelte')>()
  return {
    ...actual,
    saveImage: backgroundMocks.saveImage,
  }
})

vi.mock('src/ts/server/settingsBridge.svelte', () => ({
  applyServerBackedSetting: backgroundMocks.applyServerBackedSetting,
}))

vi.mock('src/ts/util', async (importActual) => {
  const actual = await importActual<typeof import('src/ts/util')>()
  return {
    ...actual,
    selectSingleFile: backgroundMocks.selectSingleFile,
  }
})

vi.mock('src/ts/alert', () => ({
  alertError: backgroundMocks.alertError,
}))

import CustomBackgroundToggle from './CustomBackgroundToggle.svelte'
import { language } from 'src/lang'
import {
  getResourceDatabase as getDatabase,
  replaceResourceDatabase as setDatabaseLite,
  withResourceDatabaseWrite,
} from 'src/ts/server/resourceState.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function checkbox() {
  const input = target.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error('custom background checkbox not found')
  return input
}

async function flushAsync() {
  await Promise.resolve()
  await Promise.resolve()
  await tick()
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  setDatabaseLite({
    customBackground: '',
  } as any)
  backgroundMocks.alertError.mockReset()
  backgroundMocks.applyServerBackedSetting.mockReset()
  backgroundMocks.saveImage.mockReset()
  backgroundMocks.selectSingleFile.mockReset()
  backgroundMocks.applyServerBackedSetting.mockImplementation((key: string, value: unknown) => {
    if (key === 'customBackground') {
      withResourceDatabaseWrite((database) => {
        database.customBackground = value as string
      })
    }
  })
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  setDatabaseLite({} as any)
})

describe('CustomBackgroundToggle local upload state', () => {
  it('keeps the durable setting unchanged when image upload fails', async () => {
    const selectedData = new Uint8Array([1, 2, 3])
    backgroundMocks.selectSingleFile.mockResolvedValue({
      data: selectedData,
      name: 'background.png',
    })
    backgroundMocks.saveImage.mockRejectedValue(new Error('upload failed'))

    component = mount(CustomBackgroundToggle, { target })
    checkbox().click()
    await tick()

    await vi.waitFor(() => expect(backgroundMocks.alertError).toHaveBeenCalledWith('upload failed'))

    expect(backgroundMocks.saveImage).toHaveBeenCalledWith(selectedData)
    expect(backgroundMocks.applyServerBackedSetting).not.toHaveBeenCalled()
    expect(getDatabase().customBackground).toBe('')
  })

  it('persists only the completed image asset', async () => {
    const selectedData = new Uint8Array([1, 2, 3])
    backgroundMocks.selectSingleFile.mockResolvedValue({
      data: selectedData,
      name: 'background.png',
    })
    backgroundMocks.saveImage.mockResolvedValue('uploaded-background')

    component = mount(CustomBackgroundToggle, { target })
    checkbox().click()

    await vi.waitFor(() => {
      expect(backgroundMocks.applyServerBackedSetting).toHaveBeenCalledWith('customBackground', 'uploaded-background')
    })

    expect(backgroundMocks.applyServerBackedSetting.mock.calls).toEqual([['customBackground', 'uploaded-background']])
    expect(getDatabase().customBackground).toBe('uploaded-background')
  })

  it('treats picker cancellation as a durable no-op', async () => {
    backgroundMocks.selectSingleFile.mockResolvedValue(undefined)

    component = mount(CustomBackgroundToggle, { target })
    checkbox().click()
    await vi.waitFor(() => expect(backgroundMocks.selectSingleFile).toHaveBeenCalledOnce())
    await flushAsync()

    expect(backgroundMocks.saveImage).not.toHaveBeenCalled()
    expect(backgroundMocks.applyServerBackedSetting).not.toHaveBeenCalled()
    expect(getDatabase().customBackground).toBe('')
    expect(checkbox().checked).toBe(false)
  })

  it('drops stale upload completion after a later disable', async () => {
    const selectedData = new Uint8Array([4, 5, 6])
    const upload = createDeferred<string>()
    backgroundMocks.selectSingleFile.mockResolvedValue({
      data: selectedData,
      name: 'background.png',
    })
    backgroundMocks.saveImage.mockReturnValue(upload.promise)

    component = mount(CustomBackgroundToggle, { target })
    checkbox().click()
    await vi.waitFor(() => {
      expect(backgroundMocks.saveImage).toHaveBeenCalledWith(selectedData)
    })
    await tick()

    expect(getDatabase().customBackground).toBe('')
    expect(checkbox().checked).toBe(true)

    checkbox().click()
    await tick()

    expect(getDatabase().customBackground).toBe('')

    upload.resolve('uploaded-background')
    await flushAsync()

    expect(backgroundMocks.applyServerBackedSetting).not.toHaveBeenCalled()
    expect(getDatabase().customBackground).toBe('')
    expect(backgroundMocks.alertError).toHaveBeenCalledWith(language.fileSelectionStale)
  })

  it('does not restore the previous background after a stale picker cancel', async () => {
    const picker = createDeferred<undefined>()
    backgroundMocks.selectSingleFile.mockReturnValue(picker.promise)

    component = mount(CustomBackgroundToggle, { target })
    checkbox().click()
    await vi.waitFor(() => {
      expect(backgroundMocks.selectSingleFile).toHaveBeenCalledWith(['png', 'webp', 'gif'])
    })

    expect(getDatabase().customBackground).toBe('')

    withResourceDatabaseWrite((database) => {
      database.customBackground = 'newer-background'
    })
    picker.resolve(undefined)
    await flushAsync()

    expect(backgroundMocks.applyServerBackedSetting).not.toHaveBeenCalled()
    expect(getDatabase().customBackground).toBe('newer-background')
    expect(backgroundMocks.alertError).not.toHaveBeenCalled()
  })

  it('reports a chosen file when the background changed while the picker was open', async () => {
    const picker = createDeferred<{ data: Uint8Array; name: string }>()
    backgroundMocks.selectSingleFile.mockReturnValue(picker.promise)

    component = mount(CustomBackgroundToggle, { target })
    checkbox().click()
    await vi.waitFor(() => expect(backgroundMocks.selectSingleFile).toHaveBeenCalledOnce())

    withResourceDatabaseWrite((database) => {
      database.customBackground = 'newer-background'
    })
    picker.resolve({ data: new Uint8Array([1, 2, 3]), name: 'chosen.png' })
    await flushAsync()

    expect(backgroundMocks.saveImage).not.toHaveBeenCalled()
    expect(backgroundMocks.applyServerBackedSetting).not.toHaveBeenCalled()
    expect(backgroundMocks.alertError).toHaveBeenCalledWith(language.fileSelectionStale)
  })

  it('does not restore and reports after a stale upload error', async () => {
    const selectedData = new Uint8Array([7, 8, 9])
    const upload = createDeferred<string>()
    backgroundMocks.selectSingleFile.mockResolvedValue({
      data: selectedData,
      name: 'background.png',
    })
    backgroundMocks.saveImage.mockReturnValue(upload.promise)

    component = mount(CustomBackgroundToggle, { target })
    checkbox().click()
    await vi.waitFor(() => {
      expect(backgroundMocks.saveImage).toHaveBeenCalledWith(selectedData)
    })

    expect(getDatabase().customBackground).toBe('')

    withResourceDatabaseWrite((database) => {
      database.customBackground = 'newer-background'
    })
    upload.reject(new Error('upload failed'))
    await flushAsync()

    expect(backgroundMocks.applyServerBackedSetting).not.toHaveBeenCalled()
    expect(getDatabase().customBackground).toBe('newer-background')
    expect(backgroundMocks.alertError).toHaveBeenCalledWith(language.fileSelectionStale)
  })

  it('drops upload completion after the owning component is destroyed', async () => {
    const upload = createDeferred<string>()
    backgroundMocks.selectSingleFile.mockResolvedValue({
      data: new Uint8Array([10, 11, 12]),
      name: 'background.png',
    })
    backgroundMocks.saveImage.mockReturnValue(upload.promise)

    component = mount(CustomBackgroundToggle, { target })
    checkbox().click()
    await vi.waitFor(() => expect(backgroundMocks.saveImage).toHaveBeenCalledOnce())

    unmount(component)
    component = undefined
    upload.resolve('stale-background')
    await flushAsync()

    expect(backgroundMocks.applyServerBackedSetting).not.toHaveBeenCalled()
    expect(getDatabase().customBackground).toBe('')
  })

  it('durably clears the placeholder left by an older client', async () => {
    withResourceDatabaseWrite((database) => {
      database.customBackground = '-'
    })

    component = mount(CustomBackgroundToggle, { target })

    expect(backgroundMocks.applyServerBackedSetting.mock.calls).toEqual([['customBackground', '']])
    expect(getDatabase().customBackground).toBe('')
    expect(checkbox().checked).toBe(false)
  })
})
