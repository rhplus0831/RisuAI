import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { language } from '../../lang'
import DropList from './DropList.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLDivElement

beforeEach(() => {
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

describe('DropList controls', () => {
  it('names each directional action with its item', async () => {
    component = mount(DropList, { target, props: { list: ['main', 'chats'] } })
    await tick()

    const labels = Array.from(target.querySelectorAll('button'), (button) => button.getAttribute('aria-label'))
    expect(labels).toEqual([
      `${language.moveUp}: ${language.formating.main}`,
      `${language.moveDown}: ${language.formating.main}`,
      `${language.moveUp}: ${language.formating.chats}`,
      `${language.moveDown}: ${language.formating.chats}`,
    ])
  })
})
