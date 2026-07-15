import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const inlayMocks = vi.hoisted(() => ({
  getInlayAssetBlob: vi.fn(),
  listInlayAssets: vi.fn(),
  removeInlayAsset: vi.fn(),
}))

vi.mock('src/ts/process/files/inlays', () => ({
  getInlayAssetBlob: inlayMocks.getInlayAssetBlob,
  listInlayAssets: inlayMocks.listInlayAssets,
  removeInlayAsset: inlayMocks.removeInlayAsset,
}))

vi.mock('src/ts/alert', () => ({
  alertConfirm: vi.fn(async () => true),
}))

import PlaygroundInlayExplorer from './PlaygroundInlayExplorer.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })
  return { promise, resolve }
}

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  inlayMocks.getInlayAssetBlob.mockReset()
  inlayMocks.listInlayAssets.mockReset()
  inlayMocks.removeInlayAsset.mockReset()
  inlayMocks.listInlayAssets.mockResolvedValue(
    Array.from({ length: 40 }, (_, index) => [
      `asset-${index}`,
      { data: '', ext: 'json', name: `Asset ${index}`, type: 'signature' },
    ]),
  )

  vi.stubGlobal(
    'IntersectionObserver',
    class {
      disconnect() {}
      observe() {}
    },
  )
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('PlaygroundInlayExplorer', () => {
  it('selects assets beyond the currently rendered page', async () => {
    component = mount(PlaygroundInlayExplorer, { target })
    await vi.waitFor(() => expect(target.textContent).toContain('Total 40 assets'))

    const selectAll = Array.from(target.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Select All'),
    )
    expect(selectAll).toBeTruthy()
    selectAll!.click()
    await tick()

    expect(target.textContent).toContain('Deselect All (40)')
  })

  it('does not leak preview URLs resolved after unmount', async () => {
    const preview = deferred<{ data: Blob }>()
    inlayMocks.listInlayAssets.mockResolvedValue([
      ['asset-1', { data: '', ext: 'png', name: 'Asset 1', type: 'image' }],
    ])
    inlayMocks.getInlayAssetBlob.mockReturnValue(preview.promise)
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:late-preview')
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})

    component = mount(PlaygroundInlayExplorer, { target })
    await vi.waitFor(() => expect(inlayMocks.getInlayAssetBlob).toHaveBeenCalledWith('asset-1'))

    await unmount(component)
    component = undefined
    preview.resolve({ data: new Blob(['preview'], { type: 'image/png' }) })
    await preview.promise
    await tick()

    expect(createObjectURL.mock.calls.length).toBe(revokeObjectURL.mock.calls.length)
  })
})
