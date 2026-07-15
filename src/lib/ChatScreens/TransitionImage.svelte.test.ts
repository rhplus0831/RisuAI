import { mount, tick, unmount } from 'svelte'
import { afterEach, describe, expect, it } from 'vitest'
import TransitionImage from './TransitionImage.svelte'
import TransitionImageTestHost from './TransitionImage.testHost.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined

async function settle() {
  await Promise.resolve()
  await tick()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
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

  it('does not let an older asynchronous source replace the newest image', async () => {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const first = deferred<string[]>()
    const second = deferred<string[]>()
    component = mount(TransitionImageTestHost, {
      target,
      props: { initialSource: first.promise },
    })
    ;(
      component as unknown as {
        setSource: (source: string[] | Promise<string[]>) => void
      }
    ).setSource(second.promise)
    await tick()
    second.resolve(['normal', '/second.webp'])
    await settle()
    first.resolve(['normal', '/first.webp'])
    await settle()

    expect(target.querySelector('img')?.getAttribute('src')).toBe('/second.webp')
  })
})
