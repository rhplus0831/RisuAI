import { mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const thanksPageMocks = vi.hoisted(() => ({
  openURL: vi.fn(),
}))

vi.mock('src/ts/globalApi.svelte', () => ({
  openURL: thanksPageMocks.openURL,
}))
vi.mock('./supporters', () => ({
  loadSupporters: vi.fn(async () => ({ V: [], IV: [], III: [], II: [], I: [] })),
}))

import ThanksPage from './ThanksPage.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
  thanksPageMocks.openURL.mockReset()
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = undefined
  }
  target.remove()
})

describe('ThanksPage supporter actions', () => {
  it('names the branded image button and keeps both actions native', () => {
    component = mount(ThanksPage, { target })

    const patreonButton = target.querySelector<HTMLButtonElement>(
      `button[aria-label="${language.supporterThanks}: Patreon"]`,
    )
    const addNameButton = Array.from(target.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent?.trim() === 'ADD YOUR NAME',
    )

    expect(patreonButton?.type).toBe('button')
    expect(patreonButton?.querySelector('img')?.alt).toBe('')
    expect(addNameButton?.type).toBe('button')

    patreonButton?.click()
    addNameButton?.click()

    expect(thanksPageMocks.openURL.mock.calls).toEqual([
      ['https://www.patreon.com/RisuAI'],
      ['https://sv.risuai.xyz/patreon'],
    ])
  })
})
