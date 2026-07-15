import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

const assetInputMocks = vi.hoisted(() => ({
  database: {
    characters: [] as Array<Record<string, unknown>>,
  },
  getFileSrc: vi.fn(async (assetId: string) => `/api/v1/assets/${assetId}`),
  setCharacterByIndex: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => assetInputMocks.database,
  setCharacterByIndex: assetInputMocks.setCharacterByIndex,
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  getFileSrc: assetInputMocks.getFileSrc,
  saveAsset: vi.fn(),
}))

vi.mock('src/ts/stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return { selectedCharID: writable(0) }
})

vi.mock('src/ts/util', () => ({
  selectMultipleFile: vi.fn(),
}))

import AssetInput from './AssetInput.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLDivElement

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target?.remove()
  vi.clearAllMocks()
})

describe('AssetInput', () => {
  it('renders separate entries that share a content-addressed asset id', async () => {
    const sharedAssetId = 'a'.repeat(64)
    const currentCharacter = {
      type: 'character',
      chaId: 'character-a',
      additionalAssets: [
        ['first.png', sharedAssetId, 'png'],
        ['second.png', sharedAssetId, 'png'],
      ],
    }
    assetInputMocks.database.characters = [currentCharacter]
    target = document.createElement('div')
    document.body.appendChild(target)

    component = mount(AssetInput, {
      target,
      props: {
        currentCharacter: currentCharacter as any,
        onSelect: vi.fn(),
      },
    })
    await tick()
    await Promise.resolve()
    await tick()

    expect(target.querySelectorAll('img')).toHaveLength(2)
    expect(Array.from(target.querySelectorAll('img'), (image) => image.alt)).toEqual(['first.png', 'second.png'])
    expect(Array.from(target.querySelectorAll('button'), (button) => button.getAttribute('aria-label'))).toEqual([
      `${language.add} ${language.additionalAssets}`,
      'first.png',
      'second.png',
    ])
  })
})
