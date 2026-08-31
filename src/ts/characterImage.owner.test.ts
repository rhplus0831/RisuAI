import { beforeEach, describe, expect, it, vi } from 'vitest'

const imageState = vi.hoisted(() => ({
  getFileSrc: vi.fn(async (source: string) => `file:${source}`),
  settingsResourceState: {
    value: {} as { hideAllImages?: boolean },
    status: 'ready',
    groupStatuses: { display: 'ready' },
  },
}))

vi.mock('./fileSource', () => ({ getFileSrc: imageState.getFileSrc }))
vi.mock('./server/resourceState.svelte', () => ({ settingsResourceState: imageState.settingsResourceState }))

import { getCharImage } from './characterImage'

beforeEach(() => {
  imageState.getFileSrc.mockClear()
  imageState.settingsResourceState.value = { hideAllImages: false }
  imageState.settingsResourceState.status = 'ready'
  imageState.settingsResourceState.groupStatuses.display = 'ready'
})

describe('character image settings ownership', () => {
  it('resolves images from the ready settings owner', async () => {
    await expect(getCharImage('avatar', 'plain')).resolves.toBe('file:avatar')
    expect(imageState.getFileSrc).toHaveBeenCalledWith('avatar')
  })

  it('honors the shell owner before the complete display group is ready', async () => {
    imageState.settingsResourceState.groupStatuses.display = 'loading'
    imageState.settingsResourceState.value.hideAllImages = true

    await expect(getCharImage('avatar', 'plain')).resolves.toBe('/none.webp')
    expect(imageState.getFileSrc).not.toHaveBeenCalled()
  })

  it.each([
    ['settings', 'error', 'ready'],
    ['display group', 'ready', 'error'],
  ] as const)('fails closed when the %s owner is in error', async (_label, settingsStatus, displayStatus) => {
    imageState.settingsResourceState.status = settingsStatus
    imageState.settingsResourceState.groupStatuses.display = displayStatus

    await expect(getCharImage('avatar', 'css')).resolves.toBe('')
    expect(imageState.getFileSrc).not.toHaveBeenCalled()
  })
})
