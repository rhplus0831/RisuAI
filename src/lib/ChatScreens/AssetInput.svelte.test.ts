import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'

const assetInputMocks = vi.hoisted(() => ({
  characters: [] as Array<Record<string, unknown>>,
  getFileSrc: vi.fn(async (assetId: string) => `/api/v1/assets/${assetId}`),
  owner: undefined as unknown,
  rowStatuses: {} as Record<string, string>,
  status: 'idle' as string,
  setCharacterByIndex: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', () => ({
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
  selectCharacterOwner: (characters: Array<Record<string, unknown>>, selectedIndex: number) => {
    const candidate = characters[selectedIndex]
    if (typeof candidate?.chaId !== 'string') return undefined
    return characters.filter((character) => character.chaId === candidate.chaId).length === 1 ? candidate : undefined
  },
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  charactersResourceState: assetInputMocks,
  getCharacterResourceOwner: (characterId: string) => {
    const matches = assetInputMocks.characters.filter((character) => character.chaId === characterId)
    return matches.length === 1 ? matches[0] : undefined
  },
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
  assetInputMocks.characters = []
  assetInputMocks.rowStatuses = {}
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

  it('renders the ready resource owner instead of a divergent compatibility prop', async () => {
    const aggregateCharacter = {
      type: 'character',
      chaId: 'character-a',
      additionalAssets: [['aggregate.png', 'aggregate-asset-id', 'png']],
    }
    const ownerCharacter = {
      type: 'character',
      chaId: 'character-a',
      additionalAssets: [['owner.png', 'owner-asset-id', 'png']],
    }
    assetInputMocks.characters = [ownerCharacter]
    assetInputMocks.owner = ownerCharacter
    assetInputMocks.status = 'ready'
    target = document.createElement('div')
    document.body.appendChild(target)

    component = mount(AssetInput, {
      target,
      props: {
        currentCharacter: aggregateCharacter as any,
        onSelect: vi.fn(),
      },
    })
    await tick()
    await Promise.resolve()
    await tick()

    expect(target.querySelector('button[aria-label="owner.png"]')).not.toBeNull()
    expect(target.querySelector('button[aria-label="aggregate.png"]')).toBeNull()
    expect(assetInputMocks.getFileSrc).toHaveBeenCalledWith('owner-asset-id')
    expect(assetInputMocks.getFileSrc).not.toHaveBeenCalledWith('aggregate-asset-id')
  })

  it('fails closed when the ready resource projection has no unique owner', async () => {
    const duplicateCharacter = {
      type: 'character',
      chaId: 'duplicate-character',
      additionalAssets: [['asset.png', 'asset-id', 'png']],
    }
    assetInputMocks.status = 'ready'
    assetInputMocks.owner = undefined
    assetInputMocks.characters = [duplicateCharacter, { ...duplicateCharacter }]
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

  it('fails closed instead of rendering the compatibility prop after a resource error', async () => {
    const currentCharacter = {
      type: 'character',
      chaId: 'character-a',
      additionalAssets: [['compatibility.png', 'compatibility-asset-id', 'png']],
    }
    assetInputMocks.status = 'error'
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

    expect(target.querySelectorAll('button')).toHaveLength(0)
    expect(assetInputMocks.getFileSrc).not.toHaveBeenCalled()
  })
})
