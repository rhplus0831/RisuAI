import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/gui/colorscheme', async () => {
  const { writable } = await import('svelte/store')
  return { ColorSchemeTypeStore: writable(false) }
})

vi.mock('src/ts/parser/parser.svelte', () => ({
  ParseMarkdown: async (value: string) => value,
}))

vi.mock('src/ts/util', () => ({
  parseMultilangString: (value: string) => ({ xx: value }),
  toLangName: (value: string) => value,
}))

vi.mock('src/ts/server/resourceState.svelte', async (importActual) => ({
  ...(await importActual<typeof import('src/ts/server/resourceState.svelte')>()),
  getResourceDatabase: () => ({ language: 'en' }),
}))

import { language } from 'src/lang'
import CreatorQuote from './CreatorQuote.svelte'

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

describe('CreatorQuote', () => {
  it('names the icon-only remove action', async () => {
    const onRemove = vi.fn()
    component = mount(CreatorQuote, { target, props: { onRemove, quote: 'Remember this.' } })
    await tick()

    const remove = target.querySelector<HTMLButtonElement>('button')
    expect(remove).toBeTruthy()
    expect(remove!.getAttribute('aria-label')).toBe(`${language.remove} ${language.creatorNotes}`)
    remove!.click()
    expect(onRemove).toHaveBeenCalledOnce()
  })
})
