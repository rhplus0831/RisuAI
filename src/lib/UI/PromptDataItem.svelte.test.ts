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
})
