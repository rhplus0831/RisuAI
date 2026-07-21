import { get } from 'svelte/store'
import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../ts/stores.svelte', async () => {
  const { writable } = await import('svelte/store')
  return {
    CharEmotion: writable([]),
    ViewBoxsize: writable({ width: 200, height: 180 }),
  }
})

vi.mock('src/ts/storage/database.svelte', () => ({
  getDatabase: () => ({}),
}))

vi.mock('../../ts/characterState', () => ({
  getEmotion: () => [],
}))

import { language } from 'src/lang'
import { ViewBoxsize } from '../../ts/stores.svelte'
import ResizeBox from './ResizeBox.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLDivElement

beforeEach(() => {
  ViewBoxsize.set({ width: 200, height: 180 })
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
