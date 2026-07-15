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

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.append(target)
  inlayMocks.listInlayAssets.mockReset()
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
})
