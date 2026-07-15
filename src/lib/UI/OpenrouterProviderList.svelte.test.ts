import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/lang', () => ({
  language: {
    goback: 'Go Back',
    provider: 'Provider',
  },
}))

import OpenrouterProviderList from './OpenrouterProviderList.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let component: MountedComponent | undefined
let target: HTMLElement

async function settle(): Promise<void> {
  await tick()
  await Promise.resolve()
  await Promise.resolve()
}

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

describe('OpenrouterProviderList dialog accessibility', () => {
  it('names its controls, contains Escape, and restores focus to the opener', async () => {
    component = mount(OpenrouterProviderList, {
      target,
      props: {
        value: 'provider-a',
        options: [
          { name: 'Provider A', slug: 'provider-a' },
          { name: 'Provider B', slug: 'provider-b' },
        ],
      },
    })
    await tick()

    const opener = target.querySelector<HTMLButtonElement>('button[aria-label="Provider: provider-a"]')
    expect(opener).not.toBeNull()
    opener?.focus()
    opener?.click()
    await settle()

    const dialog = target.querySelector<HTMLElement>('[role="dialog"]')
    const back = target.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    const input = target.querySelector<HTMLInputElement>('input[aria-label="Provider"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.getAttribute('aria-modal')).toBe('true')
    expect(dialog?.getAttribute('aria-labelledby')).toBe('risu-openrouter-provider-picker-title')
    expect(dialog?.classList).toContain('max-w-[calc(100vw-1rem)]')
    expect(back?.getAttribute('aria-label')).toBe('Go Back')
    expect(input).not.toBeNull()
    expect(opener?.inert).toBe(true)
    expect(document.activeElement).toBe(back)

    back?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await settle()

    expect(target.querySelector('[role="dialog"]')).toBeNull()
    expect(opener?.inert).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  it('wraps Tab from the final provider back to the dialog Back button', async () => {
    component = mount(OpenrouterProviderList, {
      target,
      props: {
        value: '',
        options: [
          { name: 'Provider A', slug: 'provider-a' },
          { name: 'Provider B', slug: 'provider-b' },
        ],
      },
    })
    await tick()

    const opener = target.querySelector<HTMLButtonElement>('button[aria-label="Provider"]')
    expect(opener?.textContent?.trim()).toBe('Provider')
    opener?.click()
    await settle()

    const back = target.querySelector<HTMLButtonElement>('[data-modal-initial-focus]')
    const providerButtons = Array.from(target.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).filter(
      (button) => !button.hasAttribute('data-modal-initial-focus'),
    )
    const lastProvider = providerButtons.at(-1)
    expect(lastProvider?.textContent?.trim()).toBe('Provider B (provider-b)')

    lastProvider?.focus()
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    lastProvider?.dispatchEvent(tab)

    expect(tab.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(back)
  })
})
