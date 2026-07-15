import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import TransitionImage from './TransitionImage.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined

async function settle() {
  await Promise.resolve()
  await tick()
}

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  document.body.innerHTML = ''
})

describe('TransitionImage source normalization', () => {
  it('does not render the normal style sentinel as an image URL', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    component = mount(TransitionImage, {
      target,
      props: { classType: 'waifu', src: Promise.resolve(['normal']) },
    })

    await settle()

    expect(target.querySelector('img')).toBeNull()
  })

  it('removes a style sentinel without mutating the supplied array', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const source = ['normal', '/emotion.webp']
    component = mount(TransitionImage, {
      target,
      props: { classType: 'waifu', src: source },
    })

    await settle()

    expect(source).toEqual(['normal', '/emotion.webp'])
    expect(target.querySelector('img')?.getAttribute('src')).toBe('/emotion.webp')
  })
})
