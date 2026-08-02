import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./GUI/TextAreaInput.svelte', async () => ({
  default: (await import('./PromptDataItem.testStub.svelte')).default,
}))

vi.mock('src/ts/server/resourceState.svelte', () => ({
  getResourceDatabase: () => ({
    promptSettings: {
      customChainOfThought: false,
      sendChatAsSystem: false,
    },
  }),
}))

import PromptDataItemTestHost from './PromptDataItem.testHost.svelte'
import { language } from 'src/lang'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

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

describe('PromptDataItem disclosure control', () => {
  it('names the remove and move actions for their prompt item', async () => {
    component = mount(PromptDataItemTestHost, { target })
    await tick()

    const actionNames = Array.from(target.querySelectorAll<HTMLButtonElement>('button[aria-label]')).map((button) =>
      button.getAttribute('aria-label'),
    )

    expect(actionNames).toEqual([
      `${language.duplicate}: Cached context`,
      `${language.remove}: Cached context`,
      `${language.moveDown}: Cached context`,
      `${language.moveUp}: Cached context`,
    ])
    expect(new Set(actionNames).size).toBe(actionNames.length)
  })

  it('invokes the duplicate action without toggling the row', async () => {
    component = mount(PromptDataItemTestHost, { target })
    await tick()

    target.querySelector<HTMLButtonElement>(`button[aria-label="${language.duplicate}: Cached context"]`)?.click()
    await tick()

    expect(target.querySelector('[data-testid="duplicate-count"]')?.textContent).toBe('1')
    expect(target.querySelector('[data-testid="opened-state"]')?.textContent).toBe('closed')
  })

  it('uses native button activation and reports its expanded state', async () => {
    component = mount(PromptDataItemTestHost, { target })
    await tick()

    const toggle = Array.from(target.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cached context',
    )
    expect(toggle).toBeInstanceOf(HTMLButtonElement)
    expect(toggle?.type).toBe('button')
    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(target.querySelector('[data-testid="opened-state"]')?.textContent).toBe('closed')

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    await tick()

    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(target.querySelector('[data-testid="opened-state"]')?.textContent).toBe('open')

    toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }))
    await tick()

    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(target.querySelector('[data-testid="opened-state"]')?.textContent).toBe('closed')
  })

  it('names every editable field in an expanded prompt row', async () => {
    component = mount(PromptDataItemTestHost, { target })
    await tick()

    Array.from(target.querySelectorAll('button'))
      .find((button) => button.textContent?.trim() === 'Cached context')
      ?.click()
    await tick()

    const names = Array.from(target.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'), (field) =>
      field.getAttribute('aria-label'),
    )
    expect(names).toEqual([language.name, language.type, language.depth, language.role])
    expect(names.every(Boolean)).toBe(true)
  })
})
