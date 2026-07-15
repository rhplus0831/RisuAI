import { mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const rerollListMocks = vi.hoisted(() => ({
  getRerollCandidates: vi.fn(() => [
    {
      index: 0,
      active: false,
      messages: [{ data: 'candidate text', role: 'char', chatId: 'candidate-message' }],
    },
  ]),
}))

vi.mock('src/ts/process/rerollNavigation.svelte', () => ({
  getRerollCandidates: rerollListMocks.getRerollCandidates,
}))

vi.mock('src/lang', () => ({
  language: new Proxy(
    {},
    {
      get: (_target, property) => String(property),
    },
  ),
}))

import RerollList from './RerollList.svelte'

type MountedComponent = Parameters<typeof unmount>[0]

let target: HTMLElement
let component: MountedComponent | null = null

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})

afterEach(() => {
  if (component) {
    unmount(component)
    component = null
  }
  target.remove()
  document.body.innerHTML = ''
  vi.clearAllMocks()
})

describe('RerollList', () => {
  it('announces which response candidate is active', async () => {
    rerollListMocks.getRerollCandidates.mockReturnValueOnce([
      {
        index: 0,
        active: true,
        messages: [{ data: 'active text', role: 'char', chatId: 'active-message' }],
      },
      {
        index: 1,
        active: false,
        messages: [{ data: 'other text', role: 'char', chatId: 'other-message' }],
      },
    ])
    component = mount(RerollList, {
      target,
      props: {
        currentMessage: 'active text',
        onSelectRerollCandidate: vi.fn(),
        onNewReroll: vi.fn(),
      },
    }) as MountedComponent
    await tick()

    const candidates = target.querySelectorAll<HTMLButtonElement>('.reroll-candidate')
    expect(Array.from(candidates, (candidate) => candidate.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  })

  it('does not fire candidate or new-reroll actions while disabled', async () => {
    const onSelectRerollCandidate = vi.fn()
    const onNewReroll = vi.fn()
    component = mount(RerollList, {
      target,
      props: {
        currentMessage: 'current text',
        disabled: true,
        onSelectRerollCandidate,
        onNewReroll,
      },
    }) as MountedComponent
    await tick()

    const candidate = target.querySelector<HTMLButtonElement>('.reroll-candidate')
    const newReroll = target.querySelector<HTMLButtonElement>('.button-icon-new-reroll')
    expect(candidate?.disabled).toBe(true)
    expect(newReroll?.disabled).toBe(true)

    candidate?.click()
    newReroll?.click()
    await tick()

    expect(onSelectRerollCandidate).not.toHaveBeenCalled()
    expect(onNewReroll).not.toHaveBeenCalled()
  })
})
