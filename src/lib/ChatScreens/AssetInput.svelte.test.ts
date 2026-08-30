import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

const assetInputMocks = vi.hoisted(() => ({
  database: {
    characters: [] as Array<Record<string, unknown>>,
  },
  getFileSrc: vi.fn(async (assetId: string) => `/api/v1/assets/${assetId}`),
  owner: undefined as unknown,
  status: 'idle' as string,
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

vi.mock('src/ts/characterState', () => ({
  getSelectedCharacterOwner: () => assetInputMocks.owner,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  charactersResourceState: assetInputMocks,
}))

vi.mock('src/ts/filePicker', () => ({
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
  assetInputMocks.owner = undefined
  assetInputMocks.status = 'idle'
})

describe('AssetInput', () => {
  it('classifies persisted media extensions case-insensitively without changing asset identity', async () => {
    const videoAsset: [string, string, string] = ['Trailer.MP4', 'video-asset-id', 'MP4']
    const audioAsset: [string, string, string] = ['Theme.Mp3', 'audio-asset-id', 'Mp3']
    const currentCharacter = {
      type: 'character',
      chaId: 'character-a',
      additionalAssets: [videoAsset, audioAsset],
    }
    const onSelect = vi.fn()
    assetInputMocks.database.characters = [currentCharacter]
    target = document.createElement('div')
    document.body.appendChild(target)

    component = mount(AssetInput, {
      target,
      props: {
        currentCharacter: currentCharacter as any,
        onSelect,
      },
    })
    await tick()
    await Promise.resolve()
    await tick()

    const videoButton = target.querySelector<HTMLButtonElement>('button[aria-label="Trailer.MP4"]')
    const audioButton = target.querySelector<HTMLButtonElement>('button[aria-label="Theme.Mp3"]')
    expect(videoButton?.querySelector('source')?.getAttribute('src')).toBe('/api/v1/assets/video-asset-id')
    expect(videoButton?.querySelector('source')?.getAttribute('type')).toBe('video/mp4')
    expect(videoButton?.querySelector('img')).toBeNull()
    expect(audioButton?.querySelector('svg')).not.toBeNull()
    expect(audioButton?.querySelector('img, video')).toBeNull()

    videoButton?.click()
    audioButton?.click()
    expect(onSelect).toHaveBeenNthCalledWith(1, videoAsset)
    expect(onSelect).toHaveBeenNthCalledWith(2, audioAsset)
    expect(currentCharacter.additionalAssets).toEqual([
      ['Trailer.MP4', 'video-asset-id', 'MP4'],
      ['Theme.Mp3', 'audio-asset-id', 'Mp3'],
    ])
  })

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

  it('fails closed when the ready resource projection has no unique owner', async () => {
    const duplicateCharacter = {
      type: 'character',
      chaId: 'duplicate-character',
      additionalAssets: [['asset.png', 'asset-id', 'png']],
    }
    assetInputMocks.status = 'ready'
    assetInputMocks.owner = undefined
    target = document.createElement('div')
    document.body.appendChild(target)

    component = mount(AssetInput, {
      target,
      props: {
        currentCharacter: duplicateCharacter as any,
        onSelect: vi.fn(),
      },
    })
    await tick()

    expect(target.querySelectorAll('button')).toHaveLength(0)
    expect(assetInputMocks.getFileSrc).not.toHaveBeenCalled()
  })
})
