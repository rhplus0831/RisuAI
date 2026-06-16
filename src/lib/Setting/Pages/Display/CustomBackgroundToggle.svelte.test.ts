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
import { DBState } from 'src/ts/stores.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | undefined

function checkbox() {
  const input = target.querySelector<HTMLInputElement>('input[type="checkbox"]')
  if (!input) throw new Error('custom background checkbox not found')
  return input
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  DBState.db = {
    customBackground: '',
  } as any
  backgroundMocks.alertError.mockReset()
  backgroundMocks.applyServerBackedSetting.mockReset()
  backgroundMocks.saveImage.mockReset()
  backgroundMocks.selectSingleFile.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  DBState.db = {} as any
})

describe('CustomBackgroundToggle upload rollback', () => {
  it('rolls back the placeholder setting when image upload fails', async () => {
    const selectedData = new Uint8Array([1, 2, 3])
    backgroundMocks.selectSingleFile.mockResolvedValue({
      data: selectedData,
      name: 'background.png',
    })
    backgroundMocks.saveImage.mockRejectedValue(new Error('upload failed'))

    component = mount(CustomBackgroundToggle, { target })
    checkbox().click()
    await tick()

    await vi.waitFor(() => {
      expect(backgroundMocks.applyServerBackedSetting).toHaveBeenCalledTimes(2)
    })

    expect(backgroundMocks.saveImage).toHaveBeenCalledWith(selectedData)
    expect(backgroundMocks.applyServerBackedSetting.mock.calls).toEqual([
      ['customBackground', '-'],
      ['customBackground', ''],
    ])
    expect(backgroundMocks.alertError).toHaveBeenCalledWith('upload failed')
  })
})
