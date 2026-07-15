import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))

import Accordion from './Accordion.svelte'

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
  document.body.innerHTML = ''
})

describe('Accordion disclosure semantics', () => {
  it('associates the disclosure with its region without nesting the Help action', async () => {
    component = mount(Accordion, {
      target,
      props: {
        name: 'Advanced options',
        styled: true,
        help: 'bias',
      },
    })

    const buttons = target.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons).toHaveLength(2)
    expect(target.querySelector('button button')).toBeNull()

    const disclosure = buttons[0]
    const help = buttons[1]
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(help.parentElement?.parentElement).toBe(disclosure.parentElement)

    disclosure.click()
    await tick()

    const panel = target.querySelector<HTMLElement>('[role="region"]')
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(disclosure.getAttribute('aria-controls')).toBe(panel?.id)
    expect(panel?.getAttribute('aria-labelledby')).toBe(disclosure.id)
  })
})
