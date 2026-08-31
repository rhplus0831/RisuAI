import { get } from 'svelte/store'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resizeBoxMocks = vi.hoisted(() => ({
  charactersResourceState: {
    status: 'ready',
    rowStatuses: {} as Record<string, string>,
  },
  selectedCharacter: { chaId: 'owner-character', name: 'Owner character' },
  getEmotionForCharacter: vi.fn(() => []),
}))

vi.mock('../../ts/stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    CharEmotion: writable({}),
    ViewBoxsize: writable({ width: 200, height: 180 }),
  }
})

vi.mock('src/ts/server/resourceState.svelte', () => ({
  charactersResourceState: resizeBoxMocks.charactersResourceState,
}))

vi.mock('../../ts/characterState', () => ({
  getSelectedCharacterOwner: () => resizeBoxMocks.selectedCharacter,
  getEmotionForCharacter: resizeBoxMocks.getEmotionForCharacter,
}))

import { language } from 'src/lang'
import { ViewBoxsize } from '../../ts/stores.svelte'
import ResizeBox from './ResizeBox.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLDivElement

beforeEach(() => {
  ViewBoxsize.set({ width: 200, height: 180 })
  resizeBoxMocks.charactersResourceState.status = 'ready'
  resizeBoxMocks.charactersResourceState.rowStatuses = {}
  resizeBoxMocks.getEmotionForCharacter.mockClear()
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

describe('ResizeBox keyboard controls', () => {
  it('renders from the selected character owner and fails closed on resource errors', async () => {
    component = mount(ResizeBox, { target })
    await tick()

    expect(resizeBoxMocks.getEmotionForCharacter).toHaveBeenLastCalledWith(
      resizeBoxMocks.selectedCharacter,
      {},
      'plain',
    )

    unmount(component)
    component = undefined
    resizeBoxMocks.charactersResourceState.status = 'error'
    resizeBoxMocks.getEmotionForCharacter.mockClear()
    component = mount(ResizeBox, { target })
    await tick()

    expect(resizeBoxMocks.getEmotionForCharacter).toHaveBeenLastCalledWith(undefined, {}, 'plain')
  })

  it('names the resize handle and changes both dimensions with arrow keys', async () => {
    component = mount(ResizeBox, { target })
    await tick()

    const handle = target.querySelector<HTMLButtonElement>(`button[aria-label="${language.resizeCharacterImage}"]`)
    expect(handle).toBeTruthy()

    handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }))
    handle!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))

    expect(get(ViewBoxsize)).toEqual({ width: 216, height: 196 })
  })

  it('uses a larger resize step while Shift is held', async () => {
    component = mount(ResizeBox, { target })
    await tick()

    const handle = target.querySelector<HTMLButtonElement>('button')!
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }),
    )

    expect(get(ViewBoxsize).width).toBe(264)
  })
})
